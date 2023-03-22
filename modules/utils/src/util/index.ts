import { spawnSync } from 'child_process';

export function spawn(command: string[], module = '.', show = false): void | Error {
  const place = module === '.' ? '<root>' : module;
  console.info(`${place}$ ${command.join(' ')}`);
  const [cmd, ...args] = command;
  const { output, stdout, stderr, status, error } = spawnSync(cmd, args, { cwd: module, env: process.env });
  const errString = (error?.message || '') + (stderr?.toString() || '');
  if (errString.length > 0) {
    console.log(stdout);
    console.error(`${place}> "${output}" status: ${status}`);
    if (status !== 0) {
      throw Error(place + ': ' + (errString.substring(0, errString.indexOf('\n'))));
    }
    if (show) {
      console.log(`${place}> ${output}`);
    }
  }
}