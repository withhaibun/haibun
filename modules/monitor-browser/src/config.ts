import fs from "fs";
import path from "path";

export const getPorts = (mode: string = process.env.NODE_ENV || "development") => {
	let env: Record<string, string> = process.env as Record<string, string>;
	const envPath = path.join(process.cwd(), ".env");

	if (fs.existsSync(envPath)) {
		try {
			const content = fs.readFileSync(envPath, "utf-8");
			const parsed = content.split("\n").reduce(
				(acc, line) => {
					const match = line.match(/^([^=]+)=(.*)$/);
					if (match) {
						acc[match[1].trim()] = match[2].trim();
					}
					return acc;
				},
				{} as Record<string, string>,
			);
			env = { ...env, ...parsed };
		} catch (_e) {
			// Ignore error reading .env
		}
	}

	return {
		clientPort: parseInt(env.HAIBUN_O_MONITOR_CLIENT_PORT || "3465", 10),
		serverPort: parseInt(env.HAIBUN_O_MONITOR_SERVER_PORT || "3459", 10),
	};
};
