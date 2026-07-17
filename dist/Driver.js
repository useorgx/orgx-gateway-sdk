/**
 * Driver interface — an implementation detail INSIDE a plugin peer.
 *
 * A plugin peer opens its own WebSocket to OrgX server, receives
 * task.dispatch messages, and delegates execution to its driver.
 * The server never talks to drivers directly; drivers are not plugins
 * of the gateway. The peer owns the driver entirely.
 */
export {};
//# sourceMappingURL=Driver.js.map