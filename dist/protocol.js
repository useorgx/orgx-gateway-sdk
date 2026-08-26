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
export const SOURCE_SUB_TYPES = [
    'subscription',
    'api_key',
    'enterprise_key',
    'user_managed',
];
/**
 * Parse the exact billing/auth source asserted by a peer terminal receipt.
 * `user_managed` is intentionally non-speculative: use it when the client can
 * prove the provider but cannot observe whether the user's local credential is
 * OAuth, a subscription, or an API key.
 */
export function parseSourceSubType(value) {
    if (typeof value === 'string' &&
        SOURCE_SUB_TYPES.includes(value)) {
        return value;
    }
    throw new TypeError(`source_sub_type must be one of: ${SOURCE_SUB_TYPES.join(', ')}`);
}
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