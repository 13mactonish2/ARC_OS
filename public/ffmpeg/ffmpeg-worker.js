/* REDSEC 8.0 — ffmpeg.wasm worker host (classic worker, bundler-free).
 * Loads the UMD @ffmpeg/core build directly via importScripts so no bundler
 * ever touches the dynamic import chain (the known webpack pitfall of
 * @ffmpeg/ffmpeg's module worker). Protocol:
 *   → { id, type: 'load' }
 *   → { id, type: 'run', args: string[], files: [{ name, data: ArrayBuffer }], outputs: string[] }
 *   ← { id, type: 'ready' }
 *   ← { id, type: 'progress', data: { progress, time } }
 *   ← { id, type: 'log', data: { type, message } }
 *   ← { id, type: 'done', data: { name: Uint8Array }[] }   (outputs in order)
 *   ← { id, type: 'error', data: string }
 */

var CORE_DIR = '/ffmpeg/'
var core = null

function toBuf(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
}

self.onmessage = async function (e) {
  var msg = e.data
  var id = msg.id
  try {
    if (msg.type === 'load') {
      if (!core) {
        importScripts(CORE_DIR + 'ffmpeg-core.js')
        if (typeof self.createFFmpegCore !== 'function') throw new Error('core script did not expose createFFmpegCore')
        core = await self.createFFmpegCore({
          locateFile: function (p) { return CORE_DIR + p },
        })
        core.setLogger(function (d) {
          self.postMessage({ id: id, type: 'log', data: { type: d.type, message: d.message } })
        })
        core.setProgress(function (d) {
          self.postMessage({ id: id, type: 'progress', data: { progress: d.progress, time: d.time } })
        })
      }
      self.postMessage({ id: id, type: 'ready' })
      return
    }

    if (msg.type === 'run') {
      if (!core) {
        // lazy-load on first run too
        importScripts(CORE_DIR + 'ffmpeg-core.js')
        core = await self.createFFmpegCore({ locateFile: function (p) { return CORE_DIR + p } })
        core.setLogger(function (d) {
          self.postMessage({ id: id, type: 'log', data: { type: d.type, message: d.message } })
        })
        core.setProgress(function (d) {
          self.postMessage({ id: id, type: 'progress', data: { progress: d.progress, time: d.time } })
        })
      }
      var files = msg.files || []
      for (var i = 0; i < files.length; i++) {
        core.FS.writeFile(files[i].name, new Uint8Array(files[i].data))
      }
      core.setTimeout(-1)
      core.exec.apply(core, msg.args)
      var ret = core.ret
      core.reset()
      if (ret !== 0) {
        // clean up inputs before bailing
        for (var j = 0; j < files.length; j++) { try { core.FS.unlink(files[j].name) } catch (err) {} }
        throw new Error('ffmpeg exited with code ' + ret + ' — check the log for details')
      }
      var outs = []
      var outputs = msg.outputs || []
      for (var k = 0; k < outputs.length; k++) {
        var data = core.FS.readFile(outputs[k])
        outs.push({ name: outputs[k], data: toBuf(data) })
        try { core.FS.unlink(outputs[k]) } catch (err) {}
      }
      for (var m = 0; m < files.length; m++) { try { core.FS.unlink(files[m].name) } catch (err) {} }
      self.postMessage({ id: id, type: 'done', data: outs })
      return
    }

    self.postMessage({ id: id, type: 'error', data: 'unknown message type: ' + msg.type })
  } catch (err) {
    self.postMessage({ id: id, type: 'error', data: (err && err.message) || String(err) })
  }
}
