#!/usr/bin/env node
// Add a user, reset their password, or remove them.
//
//   node tools/add-user.js <username>            add, or reset the password
//   node tools/add-user.js <username> --remove   remove
//   node tools/add-user.js --list                list users
//
// The password is asked for twice without echoing. It can also be piped in on
// stdin (one line) for scripted setups. Uses USERS_FILE, like the server.
// On the VM run it as the service user so the file keeps the right owner:
//   cd /opt/nomnoms-api && sudo -u nomnoms USERS_FILE=/var/lib/nomnoms/users.json node tools/add-user.js yourname

import readline from 'node:readline';
import { config } from '../config.js';
import { hashPassword, readUsers, writeUsers, USERNAME_RE, MIN_PASSWORD } from '../auth.js';

function ask(prompt, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(prompt); };
    }
    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const users = await readUsers();

  if (args.includes('--list')) {
    if (!users.length) console.log(`No users in ${config.usersFile}`);
    for (const u of users) console.log(`${u.username} (${u.role || 'admin'})`);
    return;
  }

  const username = String(args.find((a) => !a.startsWith('--')) || '').toLowerCase();
  if (!USERNAME_RE.test(username)) {
    console.error('Usage: node tools/add-user.js <username> [--remove] | --list');
    console.error('User names: 1-32 characters, lowercase letters, numbers, ".", "_" or "-".');
    process.exit(1);
  }

  if (args.includes('--remove')) {
    const left = users.filter((u) => u.username !== username);
    if (left.length === users.length) {
      console.error(`No user called ${username}.`);
      process.exit(1);
    }
    await writeUsers(left);
    console.log(`Removed ${username}. Their current session lasts until it expires or the service restarts.`);
    return;
  }

  const password = await ask('Password: ', true);
  if (password.length < MIN_PASSWORD) {
    console.error(`Passwords must be at least ${MIN_PASSWORD} characters.`);
    process.exit(1);
  }
  if (process.stdin.isTTY && (await ask('Repeat password: ', true)) !== password) {
    console.error("The passwords don't match.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const existing = users.find((u) => u.username === username);
  if (existing) existing.passwordHash = passwordHash;
  else users.push({ username, passwordHash, role: 'admin' });
  await writeUsers(users);
  console.log(`${existing ? 'Updated password for' : 'Added'} ${username} in ${config.usersFile}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
