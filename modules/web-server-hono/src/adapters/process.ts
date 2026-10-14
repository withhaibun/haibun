/**
 * The process an instance runs in, as its web server ends it.
 */

/** How long the process waits before it ends, so the response to the step that stops it is sent first. */
const STOP_DELAY_MS = 100;

/** Ends this process after `STOP_DELAY_MS`. SIGTERM rather than an exit runs every shutdown handler: a persistent store
 *  flushing its write-ahead log would be corrupted by an exit that skipped it. */
export function stopProcessAfter(): void {
	setTimeout(() => process.kill(process.pid, "SIGTERM"), STOP_DELAY_MS);
}
