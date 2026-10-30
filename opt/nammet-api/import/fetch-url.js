// Fetches a recipe page for import without letting the server be used to reach
// internal addresses (SSRF). Every hop, including redirects, must resolve only to
// public IP addresses, and the connection is made to the address that was checked,
// so a DNS answer can't change between the check and the request.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export class FetchError extends Error {}

const blocked = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(addr, bits, 'ipv4');
// (IPv4-mapped ::ffff:a.b.c.d is handled in isPublicAddress: a ::ffff:0:0/96 rule
// here would make BlockList treat every IPv4 address as blocked.)
for (const [addr, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) blocked.addSubnet(addr, bits, 'ipv6');

export function isPublicAddress(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 6) {
    const mapped = ip.toLowerCase().match(/^(?:0*:)*:?ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
    if (mapped) {
      const v4 = mapped[1] || [parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255, parseInt(mapped[3], 16) >> 8, parseInt(mapped[3], 16) & 255].join('.');
      return isPublicAddress(v4);
    }
  }
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

// dns.lookup replacement handed to http(s).request
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: options.family || 0 }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || !addresses.length) {
      return callback(new FetchError(`${hostname} points to a private or reserved address, so it can't be imported.`));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    throw new FetchError("That doesn't look like a web address.");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('Only http and https addresses can be imported.');
  if (url.username || url.password) throw new FetchError("Addresses with a user name or password can't be imported.");
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchError('Only the standard web ports (80 and 443) are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw new FetchError("That address is private or reserved, so it can't be imported.");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new FetchError("That address is private, so it can't be imported.");
  return url;
}

function requestOnce(url, { maxBytes, deadline }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      lookup: safeLookup,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; nammet-recipe-import/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,application/pdf;q=0.8,image/*;q=0.7,*/*;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en'
      }
    });
    const timer = setTimeout(() => req.destroy(new FetchError('The site took too long to respond.')), Math.max(1, deadline - Date.now()));

    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e instanceof FetchError ? e : new FetchError(`Couldn't reach the site (${e.code || e.message}).`));
    });

    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).toString() });
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        return reject(new FetchError(`The site answered with HTTP ${res.statusCode}.`));
      }
      if (Number(res.headers['content-length']) > maxBytes) {
        clearTimeout(timer);
        req.destroy();
        return reject(new FetchError('That page is too large to import.'));
      }

      // Size is counted after decompression so a small compressed reply can't expand without limit
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let body = res;
      if (enc === 'gzip' || enc === 'x-gzip') body = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') body = res.pipe(zlib.createInflate());
      else if (enc === 'br') body = res.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      let size = 0;
      body.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          body.destroy();
          clearTimeout(timer);
          reject(new FetchError('That page is too large to import.'));
        } else chunks.push(c);
      });
      body.on('end', () => {
        clearTimeout(timer);
        resolve({ buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '') });
      });
      body.on('error', (e) => {
        clearTimeout(timer);
        reject(new FetchError(`Couldn't read the page (${e.message}).`));
      });
    });

    req.end();
  });
}

export async function fetchUrl(input, { maxBytes = 5 * 1024 * 1024, timeoutMs = 15000, maxRedirects = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = checkUrl(String(input).trim());
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, { maxBytes, deadline });
    if (!res.redirect) return { ...res, finalUrl: url.toString() };
    url = checkUrl(res.redirect);
  }
  throw new FetchError('The page redirected too many times.');
}
