// https://github.com/stacktracejs/error-stack-parser/blob/master/dist/error-stack-parser.js#L51
const CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+\:\d+|\(native\))/m;
function parseStackTrace(error) {
  var filtered = error.stack.split('\n').filter(function (line) {
    return !!line.match(CHROME_IE_STACK_REGEXP);
  }, this);

  return filtered.map(function (line) {
    if (line.indexOf('(eval ') > -1) {
      // Throw away eval information until we implement stacktrace.js/stackframe#8
      line = line.replace(/eval code/g, 'eval').replace(/(\(eval at [^\()]*)|(\)\,.*$)/g, '');
    }
    var tokens = line.replace(/^\s+/, '').replace(/\(eval code/g, '(').split(/\s+/).slice(1);
    var locationParts = extractLocation(tokens.pop());
    var functionName = tokens.join(' ') || undefined;
    var fileName = ['eval', '<anonymous>'].indexOf(locationParts[0]) > -1 ? undefined : locationParts[0];

    return {
      function: functionName,
      file: fileName,
      line: Number(locationParts[1]),
      column: Number(locationParts[2]),
      // source: line,
    };
  }, this);
}

function extractLocation(urlLike) {
  // Fail-fast but return locations like "(native)"
  if (urlLike.indexOf(':') === -1) {
    return [urlLike];
  }

  var regExp = /(.+?)(?:\:(\d+))?(?:\:(\d+))?$/;
  var parts = regExp.exec(urlLike.replace(/[\(\)]/g, ''));
  return [parts[1], parts[2] || undefined, parts[3] || undefined];
}

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

    const read = (textContent) => {
      const parsedCommentData = this.parseCommentData(textContent);

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
    }

    const commentsIt = document.evaluate('//comment()', document, null, XPathResult.ANY_TYPE, null);
    let comment = commentsIt.iterateNext();
    while (comment) {
      read(comment.textContent);
      comment = commentsIt.iterateNext();
    }

    const elementsIt = document.evaluate('//*[@data-hm]', document, null, XPathResult.ANY_TYPE, null);
    let el = elementsIt.iterateNext();
    while (el) {
      read(el.dataset.hm);
      el = elementsIt.iterateNext();
    }

    return new HTMLSourceMap(data);
  }

  static parseCommentData(textContent) {
    textContent = textContent.trim().replace(/&quot;/g, '"');
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
    this.debugOnMouseMoveHandler = this.debugOnMouseMoveHandler.bind(this);
  }

  addMapping(node) {
    const callStack = node.frames.map(frame => this.getFrameId(frame));
    const mapping = {
      source: 'js',
      callStack,
    }
    const id = this.data.mappings.length;
    this.data.mappings.push(mapping);
    const mappingCommentEl = document.createComment(`hm mapping: ${id} ${JSON.stringify(mapping)}`);
    const mappingCommentEndEl = document.createComment(`hm mapping end: ${id}`);
    node.parentNode.insertBefore(mappingCommentEl, node);
    node.parentNode.insertBefore(mappingCommentEndEl, node.nextSibling);
  }

  getFrameId(frame) {
    const id = this.data.frames.findIndex(f => f.file === frame.file && f.line === frame.line && f.column === frame.column);
    if (id >= 0) return id;
    this.data.frames.push(frame);
    return this.data.frames.length - 1;
  }

  observe() {
    const getStackTrace = function () {
      const obj = {};
      Error.captureStackTrace(obj, getStackTrace);
      return parseStackTrace(obj);
    };

    // sue me.
    const originalFn = document.createElement;
    document.createElement = function (...args) {
      const el = originalFn.call(document, ...args);
      el.frames = getStackTrace();
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
        if ((cur.dataset && cur.dataset.htmlSourceMapObserveExempt) || cur.nodeType === 8) {
          isExempt = true;
          break;
        }
        cur = cur.parentElement;
      }
      return isExempt;
    }

    const observer = new MutationObserver((mutationsList, observer) => {
      let anyChanges = false;
      for (const mutation of mutationsList) {
        if (isExempt(mutation.target)) continue;

        if (mutation.type == 'childList') {
          for (const node of mutation.addedNodes) {
            if (isExempt(node)) continue;
            anyChanges = true;
            this.addMapping(node);
          }
        } else if (mutation.type == 'attributes') {
          // TODO
          console.log(mutation);
          console.log('The ' + mutation.attributeName + ' attribute was modified.');
        }
      }

      if (anyChanges && this.debug) {
        this.debugRender();
      }
    });

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

  debugOnMouseMoveHandler(e) {
    const debugFragmentsEl = this.debugEl.querySelector('.hm-fragments');
    const selectedMappingViewEl = this.debugEl.querySelector('.hm-selected-mapping');
    const tooltipEl = this.debugEl.querySelector('.hm-tooltip');

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
  }

  // Augments the document in-place with a mapping visualization.
  debugRender() {
    this.debug = true;

    if (this.debugEl) {
      this.debugEl.remove();
      document.removeEventListener('mousemove', this.debugOnMouseMoveHandler);
    }

    if (!this.hasDebugStyles) {
      this.hasDebugStyles = true;
      const sheetEl = document.createElement('style');
      document.head.appendChild(sheetEl);
      setTimeout(() => {
        const sheet = window.document.styleSheets[0];
        sheet.insertRule('.hm-debug { border-top: black solid 5px; }', sheet.cssRules.length);
        sheet.insertRule('.hm-tooltip { position: absolute; }', sheet.cssRules.length);
        sheet.insertRule('.hm-mapping-highlight { display: inline-block; padding: 5px; }', sheet.cssRules.length);
      }, 1);
    }

    const debugEl = this.debugEl = document.createElement('div');
    debugEl.classList.add('hm-debug');
    debugEl.dataset.htmlSourceMapObserveExempt = true;

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

      let parsedCommentData;

      if (char === '<' && allHtml.substr(i, 4) === '<!--') {
        i += 4;
        const endIndexOfComment = allHtml.indexOf('-->', i);
        const textContent = allHtml.substr(i, endIndexOfComment - i);
        parsedCommentData = HTMLSourceMap.parseCommentData(textContent);
        i = endIndexOfComment + 3;
      } else if (char === 'd' && allHtml.substr(i, 7) === 'data-hm') {
        const indexOfEquals = allHtml.indexOf('=', i);
        i = indexOfEquals + 2;
        const endIndexOfAttributeValue = allHtml.indexOf('"', i);
        const textContent = allHtml.substr(i, endIndexOfAttributeValue - i);
        parsedCommentData = HTMLSourceMap.parseCommentData(textContent);
        i = endIndexOfAttributeValue + 1;
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

      if (!parsedCommentData) continue;

      if (parsedCommentData.type === 'mapping-start') {
        const spanEl = document.createElement('span');
        spanEl.classList.add('hm-mapping-highlight');
        spanEl.style.backgroundColor = getFrameColor(parsedCommentData.mapping.callStack[0]);
        spanEl.dataset.mapping = parsedCommentData.index;
        cur.appendChild(spanEl);
        cur = spanEl;
      } else if (parsedCommentData.type === 'mapping-end') {
        cur = cur.parentElement;
      }
    }

    const selectedMappingViewEl = document.createElement('code');
    selectedMappingViewEl.classList.add('hm-selected-mapping');
    selectedMappingViewEl.style.display = 'block';
    selectedMappingViewEl.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
    selectedMappingViewEl.style.margin = '10px';
    selectedMappingViewEl.style.border = 'black solid 1px';
    selectedMappingViewEl.style.padding = '2px';
    selectedMappingViewEl.style.fontSize = '18px';
    selectedMappingViewEl.style.whiteSpace = 'pre-wrap';
    selectedMappingViewEl.style.minWidth = '400px';
    tooltipEl.appendChild(selectedMappingViewEl);

    const debugHeaderEl = document.createElement('h2');
    debugHeaderEl.textContent = 'Source Map Visualization';

    debugEl.appendChild(debugHeaderEl);
    debugEl.appendChild(debugFragmentsEl);
    debugEl.appendChild(tooltipEl);

    document.body.appendChild(debugEl);
    document.addEventListener('mousemove', this.debugOnMouseMoveHandler);
  }
}

window.HTMLSourceMap = HTMLSourceMap;
