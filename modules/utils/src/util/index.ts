import { spawnSync } from 'child_process';

export function spawn(command: string[], module = '.', opts?: { show?: boolean, env?: { [key: string]: string } }): void | Error {

  const place = module === '.' ? '<root>' : module;
  console.group(`${place}$ ${command.join(' ')}`);
  const [cmd, ...args] = command;
  const { output, stdout, stderr, status, error } = spawnSync(cmd, args, { cwd: module, env: opts?.env || process.env });
  const errString = (error?.message || '') + (stderr?.toString() || '');
  if (errString.length > 0) {
    console.log('stdout', stdout?.toString());
    console.error(`${place}> "${output}" status: ${status} errString: ${errString}`);
    if (status !== 0) {
      throw Error(place + ': ' + (errString.substring(0, errString.indexOf('\n'))));
    }
    if (opts?.show) {
      console.log(`${place}> ${output}`);
    }
  }
  console.groupEnd();
}