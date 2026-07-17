/**
 * OrgX Gateway Protocol v1/v2/v3 — wire message types.
 *
 * Each plugin peer implements this protocol directly against OrgX server.
 * See PROTOCOL.md for the wire spec; this file is the TypeScript mirror.
 */
/** Backward-compatible default until gateway servers advertise v2. */
export const PROTOCOL_VERSION = 1;
export const LATEST_PROTOCOL_VERSION = 3;
export const SUPPORTED_PROTOCOL_VERSIONS = [1, 2, 3];
export function isV2TaskDispatch(message) {
    return 'protocol_version' in message && message.protocol_version === 2;
}
export function isTaskResult(message) {
    return message.kind === 'task.result';
}
export function isTaskFinalization(message) {
    return message.kind === 'task.finalize';
}
//# sourceMappingURL=protocol.js.map