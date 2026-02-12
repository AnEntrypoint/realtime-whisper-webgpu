const fs = require('fs');

function createDebugAPI(state) {
  return {
    getDebugInfo() {
      let whisperFiles = 0;
      let ttsFiles = 0;
      try { whisperFiles = fs.readdirSync(state.config.modelsDir).filter(f => !f.startsWith('.')).length; } catch (e) {}
      try { ttsFiles = fs.readdirSync(state.config.ttsModelsDir).filter(f => !f.startsWith('.')).length; } catch (e) {}
      return {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
        models: { whisperFiles, ttsFiles }
      };
    }
  };
}

module.exports = { createDebugAPI };
