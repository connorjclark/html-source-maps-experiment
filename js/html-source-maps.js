// lul rng - for consistent and random colors.
// https://stackoverflow.com/a/19301306/2788187
const RNG = (() => {
  let m_w = 123456789;
  let m_z = 987654321;
  let mask = 0xffffffff;

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
    let result = ((m_z << 16) + (m_w & 65535)) >>> 0;
    result /= 4294967296;
    return result;
  }

  return {
    seed,
    random,
  }
})();

class HTMLSourceMap {
  static collectFromPage() {
    const data = {
      frames: [],
      mappings: [],
    };

    const commentsIt = document.evaluate('//comment()', document, null, XPathResult.ANY_TYPE, null);
    let comment = commentsIt.iterateNext();
    while (comment) {
      const parsedCommentData = this.parseCommentData(comment.textContent);

      if (parsedCommentData) {
        if (parsedCommentData.type === 'frame') {
          data.frames[parsedCommentData.index] = parsedCommentData.frame;
        } else if (parsedCommentData.type === 'mapping-start') {
          const mapping = parsedCommentData.mapping;
          mapping.commentNode = comment;
          data.mappings[parsedCommentData.index] = mapping;
        } else if (parsedCommentData.type === 'mapping-end') {
          const mapping = data.mappings[parsedCommentData.index];
          mapping.endCommentNode = comment;
        }
      }

      comment = commentsIt.iterateNext();
    }

    return new HTMLSourceMap(data);
  }

  static parseCommentData(textContent) {
    textContent = textContent.trim();
    if (textContent.startsWith('hm frame:')) {
      const [, index, json] = textContent.replace('hm frame:', '').match(/(\d+) (.*)/);
      const frame = JSON.parse(json);
      return {
        type: 'frame',
        index,
        frame,
      };
    } else if (textContent.startsWith('hm mapping:')) {
      const [, index, json] = textContent.replace('hm mapping:', '').match(/(\d+) (.*)/);
      const mapping = JSON.parse(json);
      return {
        type: 'mapping-start',
        index: parseInt(index),
        mapping,
      };
    } else if (textContent.startsWith('hm mapping end:')) {
      const index = parseInt(textContent.replace('hm mapping end:', '').trim());
      return {
        type: 'mapping-end',
        index,
      };
    }
  }

  constructor(data) {
    this.data = data;
    this.debug = false;
  }

  // TODO - create mappings during runtime when JS changes the DOM.
  observe() {
    return;

    // sue me.
    const originalFn = document.createElement;
    document.createElement = function (...args) {
      const el = originalFn.call(document, ...args);
      console.trace();
      return el;
    }

    const config = {
      attributes: true,
      childList: true,
      subtree: true,
    };

    function isExempt(el) {
      let isExempt = false;
      let cur = el;
      while (cur) {
        if (cur.dataset && cur.dataset.htmlSourceMapObserveExempt) {
          isExempt = true;
          break;
        }
        cur = cur.parentElement;
      }
      return isExempt;
    }

    // Callback function to execute when mutations are observed
    const callback = function (mutationsList, observer) {
      for (const mutation of mutationsList) {
        if (isExempt(mutation.target)) continue;

        if (mutation.type == 'childList') {
          for (const node of mutation.addedNodes) {
            if (isExempt(node)) continue;
            console.log(mutation);
            console.log('A child node has been added or removed.');
          }
        } else if (mutation.type == 'attributes') {
          console.log(mutation);
          console.log('The ' + mutation.attributeName + ' attribute was modified.');
        }
      }
    };

    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);

    // Start observing the target node for configured mutations
    observer.observe(document.body, config);
  }

  findNearestMapping(el) {
    if (!el.previousSibling) {
      return this.findNearestMapping(el.parentNode);
    }

    if (el.previousSibling.nodeType === 8) {
      const parsedNodeData = HTMLSourceMap.parseCommentData(el.previousSibling.textContent);
      if (parsedNodeData && parsedNodeData.type === 'mapping-start') {
        return this.data.mappings[parsedNodeData.index];
      }
    }

    return this.findNearestMapping(el.previousSibling);
  }

  // Augments the document in-place with a mapping visualization.
  debugRender() {
    this.debug = true;

    const debugEl = document.createElement('div');
    debugEl.classList.add('hm-debug');

    const frameToColor = new Map();
    function getFrameColor(frameId) {
      if (frameToColor.has(frameId)) return frameToColor.get(frameId);
      RNG.seed(frameId);
      const hue = Math.round(RNG.random() * 360);
      const color = `hsla(${hue}, 56%, 56%, 0.46)`;
      frameToColor.set(frameId, color);
      return color;
    }

    const tooltipEl = document.createElement('div');
    tooltipEl.classList.add('hm-tooltip');

    // This ensures all nodes outside of <html> are grabbed too.
    const allHtml = [...document.childNodes].map(node => {
      if (node.nodeType === 8) {
        return '<!--' + node.textContent + '-->';
      }

      return node.outerHTML;
    }).join('');

    const debugFragmentsEl = document.createElement('div');
    debugFragmentsEl.classList.add('hm-fragments');

    let i = 0;
    let cur = debugFragmentsEl;
    while (i < allHtml.length) {
      const char = allHtml.charAt(i);

      if (char === '<' && allHtml.substr(i, 4) === '<!--') {
        i += 4;
        const endIndexOfComment = allHtml.indexOf('-->', i);
        const textContent = allHtml.substr(i, endIndexOfComment - i);
        const parseCommentData = HTMLSourceMap.parseCommentData(textContent);
        if (parseCommentData && parseCommentData.type === 'mapping-start') {
          const spanEl = document.createElement('span');
          spanEl.classList.add('hm-mapping-highlight');
          spanEl.style.backgroundColor = getFrameColor(parseCommentData.mapping.callStack[0]);
          spanEl.dataset.mapping = parseCommentData.index;
          cur.appendChild(spanEl);
          cur = spanEl;
        } else if (parseCommentData && parseCommentData.type === 'mapping-end') {
          cur = cur.parentElement;
        }
        i = endIndexOfComment + 3;
      } else {
        i++;

        if (char === '\n') {
          cur.appendChild(document.createElement('br'));
          continue;
        }

        let textNode;
        if (cur.lastChild && cur.lastChild.nodeType === 3) {
          textNode = cur.lastChild;
        } else {
          textNode = document.createTextNode('');
          cur.appendChild(textNode);
        }

        textNode.textContent += char;
      }
    }

    document.addEventListener('mousemove', (e) => {
      if (!debugFragmentsEl.contains(e.target)) {
        tooltipEl.style.display = 'none';
        return;
      }

      const mappingIndex = e.target.dataset.mapping;
      const mapping = this.data.mappings[mappingIndex];
      if (!mapping) {
        return;
      }

      const callStack = mapping.callStack.map(i => this.data.frames[i]);
      const view = {
        source: mapping.source,
        callStack,
      };
      selectedMappingViewEl.textContent = JSON.stringify(view, null, 2);

      // i'm bad at tooltips.
      const { width, height } = selectedMappingViewEl.getBoundingClientRect(selectedMappingViewEl);
      let x = e.pageX - width / 2;
      x = Math.max(x, 0);
      x = Math.min(x, window.innerWidth - width);
      tooltipEl.style.left = x + 'px';
      tooltipEl.style.top = (e.pageY - height - 50) + 'px';
      tooltipEl.style.display = 'block';
    });

    const selectedMappingViewEl = document.createElement('code');
    selectedMappingViewEl.style.display = 'block';
    selectedMappingViewEl.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
    selectedMappingViewEl.style.margin = '10px';
    selectedMappingViewEl.style.border = 'black solid 1px';
    selectedMappingViewEl.style.padding = '2px';
    selectedMappingViewEl.style.fontSize = '18px';
    selectedMappingViewEl.style.whiteSpace = 'pre-wrap';
    selectedMappingViewEl.style.minWidth = '400px';
    tooltipEl.appendChild(selectedMappingViewEl);

    const sheetEl = document.createElement('style');
    debugEl.appendChild(sheetEl);
    setTimeout(() => {
      const sheet = window.document.styleSheets[0];
      sheet.insertRule('.hm-debug { border-top: black solid 5px; }', sheet.cssRules.length);
      sheet.insertRule('.hm-tooltip { position: absolute; }', sheet.cssRules.length);
      sheet.insertRule('.hm-mapping-highlight { display: inline-block; padding: 5px; }', sheet.cssRules.length);
    }, 1);

    const debugHeaderEl = document.createElement('h2');
    debugHeaderEl.textContent = 'Source Map Visualization';

    debugEl.appendChild(debugHeaderEl);
    debugEl.appendChild(debugFragmentsEl);
    debugEl.appendChild(tooltipEl);

    document.body.appendChild(debugEl);
  }
}

window.HTMLSourceMap = HTMLSourceMap;
