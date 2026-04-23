import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import SftpClient from "ssh2-sftp-client";

const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, "upload.config.json");
const LOCAL_FILE = path.join(PROJECT_ROOT, "dist", "index.html");

function assertConfig(value) {
	if (typeof value !== "object" || value === null) {
		throw new Error("Configuration must be a JSON object.");
	}

	const config = value;
	const requiredFields = ["host", "remotePath", "username", "password"];
	for (const field of requiredFields) {
		if (!(field in config)) {
			throw new Error(`Missing required setting: ${field}`);
		}
	}

	if (typeof config.host !== "string" || !config.host.trim()) {
		throw new Error("Setting host must be a non-empty string.");
	}
	if (config.port !== undefined && (typeof config.port !== "number" || Number.isNaN(config.port))) {
		throw new Error("Setting port must be a valid number.");
	}
	if (typeof config.username !== "string" || !config.username.trim()) {
		throw new Error("Setting username must be a non-empty string.");
	}
	if (typeof config.password !== "string" || !config.password.trim()) {
		throw new Error("Setting password must be a non-empty string.");
	}
	if (typeof config.remotePath !== "string" || !config.remotePath.trim()) {
		throw new Error("Setting remotePath must be a non-empty string.");
	}

	return {
		host: config.host,
		port: config.port ?? 22,
		username: config.username,
		password: config.password,
		remotePath: config.remotePath
	};
}

async function loadConfig() {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const parsed = JSON.parse(raw);
	return assertConfig(parsed);
}

async function main() {
	const config = await loadConfig();
	const client = new SftpClient();

	try {
		await client.connect({
			host: config.host,
			port: config.port,
			username: config.username,
			password: config.password
		});

		await client.put(LOCAL_FILE, config.remotePath);
		console.log(`Upload successful: ${LOCAL_FILE} -> ${config.host}:${config.remotePath}`);
	} finally {
		await client.end();
	}
}

function formatUploadError(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (/permission denied/i.test(message)) {
		return [
			message,
			"Hint: The SSH user has no write permission for the remote path.",
			"Use a writable target path or adjust ownership/permissions on the server."
		].join(" ");
	}

	return message;
}

main().catch((error) => {
	console.error("Upload failed:", formatUploadError(error));
	process.exitCode = 1;
});
