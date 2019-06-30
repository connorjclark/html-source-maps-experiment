class HTMLSourceMap {
  constructor(data) {
    this.data = data;
  }

  debugRender() {
    const mapEl = document.createElement('pre');
    mapEl.style['white-space'] = 'pre-wrap';

    const selectedMappingViewEl = document.createElement('div');

    // lul rng
    // https://stackoverflow.com/a/19301306/2788187
    var m_w = 123456789;
    var m_z = 987654321;
    var mask = 0xffffffff;

    // Takes any integer
    function seed(i) {
      m_w = (123456789 + i) & mask;
      m_z = (987654321 - i) & mask;
    }

    // Returns number between 0 (inclusive) and 1.0 (exclusive),
    // just like Math.random().
    function random() {
      m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
      m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
      var result = ((m_z << 16) + (m_w & 65535)) >>> 0;
      result /= 4294967296;
      return result;
    }

    const frameToColor = new Map();
    function getFrameColor(frameId) {
      if (frameToColor.has(frameId)) return frameToColor.get(frameId);
      seed(frameId);
      const hue = Math.round(random() * 360);
      const color = `hsla(${hue}, 56%, 56%, 0.46)`;
      frameToColor.set(frameId, color);
      return color;
    }

    let currentOutputIndex = 0;
    for (const [i, mapping] of Object.entries(this.data.mappings)) {
      const mappingEl = document.createElement('span');
      mapEl.appendChild(mappingEl);
      mappingEl.dataset.mappingIndex = i;
      mappingEl.textContent = this.data.output.substring(currentOutputIndex, currentOutputIndex + mapping.len);
      mappingEl.style['backgroundColor'] = getFrameColor(mapping.callStack[0]);
      currentOutputIndex += mapping.len;
    }

    mapEl.addEventListener('mouseover', (e) => {
      const mappingIndex = e.target.dataset.mappingIndex;
      if (typeof mappingIndex === 'undefined') return;

      const mapping = this.data.mappings[mappingIndex];
      const callStack = mapping.callStack.map(i => this.data.frames[i]);
      const view = {
        ...mapping,
        callStack,
      };
      selectedMappingViewEl.textContent = JSON.stringify(view, null, 2);
    });

    mapEl.appendChild(selectedMappingViewEl);
    document.body.appendChild(mapEl);
  }
}

window.HTMLSourceMap = HTMLSourceMap;
