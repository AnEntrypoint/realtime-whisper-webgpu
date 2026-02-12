const { createConfig } = require('./config');

const state = {
  config: null,
  handlers: { current: null },
  requests: { inFlight: 0, draining: false },
  reload: { count: 0, lastTime: 0, lastError: null },
  debug: { reloadEvents: [], drainEvents: [] }
};

function initState(options = {}) {
  if (!state.config) {
    state.config = createConfig(options);
  }
  return state;
}

function trackRequest() { state.requests.inFlight++; }
function untrackRequest() { state.requests.inFlight--; }
function getInFlightCount() { return state.requests.inFlight; }

function setCurrentHandlers(handlers) { state.handlers.current = handlers; }
function getCurrentHandlers() { return state.handlers.current; }

function setDraining(draining) { state.requests.draining = draining; }

function recordReload(error = null) {
  state.reload.count++;
  state.reload.lastTime = Date.now();
  if (error) state.reload.lastError = error.message;
  state.debug.reloadEvents.push({
    count: state.reload.count,
    time: state.reload.lastTime,
    error: error ? error.message : null
  });
  if (state.debug.reloadEvents.length > 100) state.debug.reloadEvents.shift();
}

function recordDrain() {
  state.debug.drainEvents.push({ time: Date.now(), inFlight: state.requests.inFlight });
  if (state.debug.drainEvents.length > 100) state.debug.drainEvents.shift();
}

function getDebugState() {
  return {
    reloadCount: state.reload.count,
    inFlightRequests: state.requests.inFlight,
    isDraining: state.requests.draining,
    lastReloadTime: state.reload.lastTime,
    lastReloadError: state.reload.lastError,
    recentEvents: {
      reloads: state.debug.reloadEvents.slice(-5),
      drains: state.debug.drainEvents.slice(-5)
    }
  };
}

module.exports = {
  initState, trackRequest, untrackRequest, getInFlightCount,
  setCurrentHandlers, getCurrentHandlers,
  setDraining, recordReload, recordDrain, getDebugState
};
