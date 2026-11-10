/**
 * Quantized teleport transition:
 * Calculates discrete intermediate stations and half-fade opacities for teleportation effects.
 *
 * Rather than a continuous mechanical glide, an entity materializes across discrete strobe
 * stations with partial opacity, conveying quantum projection / teleportation from its
 * source position into its virtual destination.
 */
import type { XYZ } from "../domains/graph-types.js";

export type TTeleportStation = { pos: XYZ; opacity: number; spokeProgress: number; stepIndex: number };

export type TTeleportOptions = { steps?: number; minOpacity?: number; maxOpacity?: number; staccato?: boolean };

export const DEFAULT_TELEPORT_STEPS = 3;
export const DEFAULT_MIN_OPACITY = 0.35;
export const DEFAULT_MAX_OPACITY = 1.0;

/**
 * Computes the station along the teleport path for progress in [0, 1].
 * Defaults to smooth continuous ease-out interpolation for fluid visual transitions.
 */
export function teleportStation(source: XYZ, target: XYZ, progress: number, options?: TTeleportOptions): TTeleportStation {
	const p = Math.max(0, Math.min(1, progress));
	const numSteps = options && options.steps !== undefined ? options.steps : DEFAULT_TELEPORT_STEPS;
	const minOp = options && options.minOpacity !== undefined ? options.minOpacity : DEFAULT_MIN_OPACITY;
	const maxOp = options && options.maxOpacity !== undefined ? options.maxOpacity : DEFAULT_MAX_OPACITY;
	const isStaccato = options && options.staccato !== undefined ? options.staccato : false;

	if (p >= 1) {
		return { pos: { x: target.x, y: target.y, z: target.z }, opacity: maxOp, spokeProgress: 1.0, stepIndex: numSteps };
	}

	if (p <= 0) {
		return { pos: { x: source.x, y: source.y, z: source.z }, opacity: 0, spokeProgress: 0, stepIndex: 0 };
	}

	if (isStaccato) {
		const stepIndex = Math.min(numSteps - 1, Math.floor(p * numSteps));
		const stepFraction = (stepIndex + 1) / numSteps;
		const x = source.x + stepFraction * (target.x - source.x);
		const y = source.y + stepFraction * (target.y - source.y);
		const z = source.z + stepFraction * (target.z - source.z);
		const opacity = minOp + (stepIndex / (numSteps - 1)) * (maxOp - minOp) * 0.85;
		const spokeProgress = Math.min(1, p * 1.5);
		return { pos: { x, y, z }, opacity, spokeProgress, stepIndex };
	}

	// Smooth continuous ease-out cubic interpolation (avoids staccato strobe / flicker)
	const easeOut = 1 - Math.pow(1 - p, 3);
	const x = source.x + easeOut * (target.x - source.x);
	const y = source.y + easeOut * (target.y - source.y);
	const z = source.z + easeOut * (target.z - source.z);
	const opacity = minOp + easeOut * (maxOp - minOp);
	const spokeProgress = easeOut;
	const stepIndex = Math.min(numSteps - 1, Math.floor(p * numSteps));

	return { pos: { x, y, z }, opacity, spokeProgress, stepIndex };
}
