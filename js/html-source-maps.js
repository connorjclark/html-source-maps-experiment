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
      const textContent = comment.textContent.trim();
      if (textContent.startsWith('hm frame:')) {
        const [, index, json] = textContent.replace('hm frame:', '').match(/(\d+) (.*)/);
        const frame = JSON.parse(json);
        data.frames[index] = frame;
      } else if (textContent.startsWith('hm mapping:')) {
        const [, index, json] = textContent.replace('hm mapping:', '').match(/(\d+) (.*)/);
        const mapping = JSON.parse(json);
        mapping.commentNode = comment;
        data.mappings[index] = mapping;
      } else if (textContent.startsWith('hm mapping end:')) {
        const index = parseInt(textContent.replace('hm mapping end:', '').trim());
        const mapping = data.mappings[index];
        mapping.endCommentNode = comment;
      }
      comment = commentsIt.iterateNext();
    }

    return new HTMLSourceMap(data);
  }

  constructor(data) {
    this.data = data;
    this.debug = false;
  }

  observe() {
    return; // TODO

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

    if (el.previousSibling.nodeType === 8 && el.previousSibling.textContent.includes('hm mapping:')) {
      const [, index] = el.previousSibling.textContent.replace('hm mapping:', '').match(/(\d+) (.*)/);
      return this.data.mappings[index];
    }

    return this.findNearestMapping(el.previousSibling);
  }

  // Augments the document in-place with a mapping visualization.
  debugRender() {
    this.debug = true;

    const frameToColor = new Map();
    function getFrameColor(frameId) {
      if (frameToColor.has(frameId)) return frameToColor.get(frameId);
      RNG.seed(frameId);
      const hue = Math.round(RNG.random() * 360);
      const color = `hsla(${hue}, 56%, 56%, 0.46)`;
      frameToColor.set(frameId, color);
      return color;
    }

    // Wrap every mapping fragment in a span, for highlighting.
    for (const mapping of this.data.mappings) {
      // TODO the first element / body element poses an issue.
      if (mapping.commentNode.parentNode === document) continue;

      const htmlFragment = [];
      let cur = mapping.commentNode.nextSibling;
      while (cur && cur !== mapping.endCommentNode) {
        htmlFragment.push(cur);
        cur = cur.nextSibling;
      }

      const wrapperEl = document.createElement('span');
      wrapperEl.classList.add('hm-mapping-highlight');
      wrapperEl.style.backgroundColor = getFrameColor(mapping.callStack[0]);

      mapping.commentNode.parentNode.insertBefore(wrapperEl, mapping.commentNode.nextSibling);
      htmlFragment.forEach(node => wrapperEl.appendChild(node));
    }

    document.addEventListener('mouseover', (e) => {
      const mapping = this.findNearestMapping(e.target);
      if (!mapping) return;

      const callStack = mapping.callStack.map(i => this.data.frames[i]);
      const view = {
        ...mapping,
        callStack,
      };
      selectedMappingViewEl.textContent = JSON.stringify(view, null, 2);
    });

    const selectedMappingViewEl = document.createElement('pre');
    document.body.appendChild(selectedMappingViewEl);
    selectedMappingViewEl.style.display = 'block';
    selectedMappingViewEl.style.margin = '10px';
    selectedMappingViewEl.style.border = 'black solid 1px';
    selectedMappingViewEl.style.padding = '2px';

    // Make everything inline and the highlight elements inline-block w/ padding - shows nested mappings better.
    const sheetEl = document.createElement('style');
    document.body.appendChild(sheetEl);
    setTimeout(() => {
      const sheet = window.document.styleSheets[0];
      sheet.insertRule('* { display: inline; }', sheet.cssRules.length);
      sheet.insertRule('.hm-mapping-highlight { display: inline-block; padding: 5px; }', sheet.cssRules.length);
    }, 1);
  }
}

window.HTMLSourceMap = HTMLSourceMap;
