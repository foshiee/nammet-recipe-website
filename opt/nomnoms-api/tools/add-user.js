#!/usr/bin/env node
// Add a user, reset their password or role, or remove them. The admin page can do
// all of this too; this tool is for creating the first admin and for emergencies.
//
//   node tools/add-user.js <username> [--role admin|importer] [--permanent]   add, or reset the password
//   node tools/add-user.js <username> --remove                                remove
//   node tools/add-user.js --list                                             list users
//
// New users are admins if there's no admin yet, otherwise importers, unless --role says
// otherwise. A password reset keeps the role unless --role is given.
//
// Passwords set here are temporary: the user chooses their own at their next sign-in.
// --permanent skips that, for example when you're setting your own.
//
// The password is asked for twice without echoing. It can also be piped in on
// stdin (one line) for scripted setups. Uses USERS_FILE, like the server.
// On the VM run it as the service user so the file keeps the right owner:
//   cd /opt/nomnoms-api && sudo -u nomnoms USERS_FILE=/var/lib/nomnoms/users.json node tools/add-user.js yourname --role admin
//
// A running service picks up new users and passwords at the next sign-in. Sessions that
// are already open keep their old role until they expire or the service restarts.

import readline from 'node:readline';
import { config } from '../config.js';
import { readUsers, listUsers, createUser, updateUser, deleteUser, USERNAME_RE, MIN_PASSWORD, ROLES } from '../auth.js';

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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node tools/add-user.js <username> [--role admin|importer] [--permanent] [--remove] | --list');
  console.error('User names: 1-32 characters, lowercase letters, numbers, ".", "_" or "-".');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const users = await listUsers();
    if (!users.length) console.log(`No users in ${config.usersFile}`);
    for (const u of users) console.log(`${u.username} (${u.role})${u.mustChangePassword ? ' - temporary password' : ''}`);
    return;
  }

  let role;
  const r = args.indexOf('--role');
  if (r >= 0) {
    role = args[r + 1];
    if (!ROLES.includes(role)) usage(`--role must be one of: ${ROLES.join(', ')}.`);
    args.splice(r, 2);
  }

  const username = String(args.find((a) => !a.startsWith('--')) || '').toLowerCase();
  if (!USERNAME_RE.test(username)) usage();

  if (args.includes('--remove')) {
    await deleteUser(username);
    console.log(`Removed ${username}. Their current session lasts until it expires or the service restarts.`);
    return;
  }

  const temporary = !args.includes('--permanent');
  const password = await ask('Password: ', true);
  if (password.length < MIN_PASSWORD) fail(`Passwords must be at least ${MIN_PASSWORD} characters.`);
  if (process.stdin.isTTY && (await ask("Repeat password: ", true)) !== password) fail("The passwords don't match.");

  const users = await readUsers();
  let done;
  if (users.some((u) => u.username === username)) {
    const changed = await updateUser(username, role ? { password, role, temporary } : { password, temporary });
    done = `Updated ${username} (${changed.role}) in ${config.usersFile}.`;
  } else {
    const hasAdmin = users.some((u) => u.role === 'admin');
    const created = await createUser({ username, password, role: role || (hasAdmin ? 'importer' : 'admin'), temporary });
    done = `Added ${username} (${created.role}) in ${config.usersFile}.`;
  }
  console.log(`${done} ${temporary ? `${username} will choose their own password at their next sign-in.` : 'The password is permanent.'}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
