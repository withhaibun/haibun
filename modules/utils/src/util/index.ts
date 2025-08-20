import { spawn } from 'child_process';

export function spawnCommand(command: string[], module = '.', opts?: { show?: boolean; env?: { [key: string]: string } }): Promise<string> {
	return new Promise((resolve, reject) => {
		const place = module === '.' ? '<root>' : module;
		console.group(`${place}$ ${command.join(' ')}`);
		const [cmd, ...args] = command;

		const child = spawn(cmd, args, {
			cwd: module,
			env: opts?.env || process.env,
			stdio: ['inherit', 'pipe', 'pipe'] // inherit stdin, pipe stdout/stderr
		});

		let stdoutData = '';
		let stderrData = '';

		child.stdout.on('data', (data) => {
			const str = data.toString();
			stdoutData += str;
			if (opts?.show) {
				process.stdout.write(str); // Stream output if show is true
			}
		});

		child.stderr.on('data', (data) => {
			const str = data.toString();
			stderrData += str;
			process.stderr.write(str); // Always show stderr
		});

		child.on('error', (error) => {
			console.error(`${place}> Error spawning command: ${error.message}`);
			console.groupEnd();
			reject(error);
		});

		child.on('close', (code) => {
			console.log(`${place}> exited with code ${code}`);
			console.groupEnd();
			if (code === 0) {
				resolve(stdoutData);
			} else {
				const errorMessage = `${place}: Command failed with code ${code}\nStderr: ${stderrData.trim()}`;
				console.error(errorMessage);
				reject(new Error(errorMessage));
			}
		});
	});
}
