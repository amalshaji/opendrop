export const ANNOTATION_BRIDGE = `<script data-opendrop-bridge>(function(){
  if (window.__opendropBridge) return;
  window.__opendropBridge = true;
  var HOST = "opendrop-host";
  var SELF = "opendrop-preview";
  var mode = "browse";
  var markers = [];
  var selectedId = null;
  var draft = null;
  var layer = null;
  var pendingRender = 0;

  function post(msg){ msg.source = SELF; try { parent.postMessage(msg, "*"); } catch (e) {} }
  function clamp01(v){ v = Number(v); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
  function docSize(){
    var d = document.documentElement, b = document.body || d;
    return { w: Math.max(d.scrollWidth, b.scrollWidth, d.clientWidth, 1), h: Math.max(d.scrollHeight, b.scrollHeight, d.clientHeight, 1) };
  }
  function ensureLayer(){
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.setAttribute("data-opendrop-layer", "");
    layer.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483000;pointer-events:none;";
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }
  function px(v){ return v + "px"; }
  function setCursor(){
    if (!document.body) return;
    document.body.style.cursor = mode === "comment" ? "crosshair" : (mode === "highlight" ? "text" : "");
  }
  function shortcutMode(key){
    key = String(key || "").toLowerCase();
    return key === "b" || key === "c" || key === "h" ? key : null;
  }
  function isEditableTarget(target){
    var el = target;
    while (el && el.nodeType === 1){
      var tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }
  function bindSelect(el, id){
    if (!id) return;
    el.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); post({ type: "select", id: id }); });
  }
  function nodePath(node){
    if (!node || !document.body) return null;
    if (node !== document.body && !document.body.contains(node)) return null;
    var parts = [];
    while (node && node !== document.body){
      var parent = node.parentNode;
      if (!parent) return null;
      var index = 0;
      var child = parent.firstChild;
      while (child && child !== node){ index++; child = child.nextSibling; }
      if (!child) return null;
      parts.unshift(index);
      node = parent;
    }
    return parts.join("/");
  }
  function nodeFromPath(path){
    var node = document.body;
    if (!node) return null;
    if (!path) return node;
    var parts = String(path).split("/");
    for (var i = 0; i < parts.length; i++){
      var index = Number(parts[i]);
      if (!Number.isInteger(index) || !node.childNodes || index < 0 || index >= node.childNodes.length) return null;
      node = node.childNodes[index];
    }
    return node;
  }
  function nodeMaxOffset(node){
    if (!node) return 0;
    return node.nodeType === Node.TEXT_NODE ? (node.nodeValue || "").length : node.childNodes.length;
  }
  function elementPath(el){
    if (!el || el.nodeType !== Node.ELEMENT_NODE || !document.body || !document.body.contains(el)) return null;
    var parts = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body){
      var tag = el.localName;
      if (!tag) return null;
      var index = 1;
      var sib = el;
      while ((sib = sib.previousElementSibling)){
        if (sib.localName === tag) index++;
      }
      parts.unshift(tag + ":nth-of-type(" + index + ")");
      el = el.parentElement;
    }
    return parts.length ? "body>" + parts.join(">") : null;
  }
  function elementFromPath(selector){
    if (!selector) return null;
    try { return document.querySelector(selector); } catch (e) { return null; }
  }
  function anchorableElement(target, clientX, clientY){
    var el = target && target.nodeType === Node.ELEMENT_NODE ? target : document.elementFromPoint(clientX, clientY);
    if (el && layer && layer.contains(el)) return null;
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body && el !== document.documentElement){
      var rect = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      if (rect.width >= 4 && rect.height >= 4 && style.display !== "contents") return el;
      el = el.parentElement;
    }
    return null;
  }
  function elementAnchor(clientX, clientY, target){
    var el = anchorableElement(target, clientX, clientY);
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var selector = elementPath(el);
    if (!selector || rect.width < 1 || rect.height < 1) return null;
    return { kind: "element", selector: selector, x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
  }
  function anchoredPoint(shape, size){
    var anchor = shape && shape.anchor;
    if (anchor && anchor.kind === "element"){
      var el = elementFromPath(anchor.selector);
      if (el){
        var rect = el.getBoundingClientRect();
        if (rect.width >= 1 && rect.height >= 1){
          return { x: rect.left + window.scrollX + clamp01(anchor.x) * rect.width, y: rect.top + window.scrollY + clamp01(anchor.y) * rect.height };
        }
      }
    }
    return { x: clamp01(shape.x) * size.w, y: clamp01(shape.y) * size.h };
  }
  function normalizedText(value){ return String(value || "").replace(/\s+/g, " ").trim(); }
  function textAnchorFromRange(range, text){
    var startPath = nodePath(range.startContainer);
    var endPath = nodePath(range.endContainer);
    if (startPath == null || endPath == null) return null;
    return {
      kind: "text-range",
      startPath: startPath,
      startOffset: Math.max(0, range.startOffset || 0),
      endPath: endPath,
      endOffset: Math.max(0, range.endOffset || 0),
      quote: String(text || "").slice(0, 2000)
    };
  }
  function rangeFromTextAnchor(anchor){
    if (!anchor || anchor.kind !== "text-range") return null;
    var start = nodeFromPath(anchor.startPath);
    var end = nodeFromPath(anchor.endPath);
    if (!start || !end) return null;
    try {
      var range = document.createRange();
      range.setStart(start, Math.min(Math.max(0, anchor.startOffset || 0), nodeMaxOffset(start)));
      range.setEnd(end, Math.min(Math.max(0, anchor.endOffset || 0), nodeMaxOffset(end)));
      if (range.collapsed) return null;
      var expected = normalizedText(anchor.quote);
      if (expected && normalizedText(range.toString()) !== expected) return null;
      return range;
    } catch (e) {
      return null;
    }
  }
  function textPointForOffset(nodes, offset){
    for (var i = 0; i < nodes.length; i++){
      var item = nodes[i];
      if (offset >= item.start && offset <= item.end){
        return { node: item.node, offset: Math.min(Math.max(0, offset - item.start), (item.node.nodeValue || "").length) };
      }
    }
    if (!nodes.length) return null;
    var last = nodes[nodes.length - 1];
    return { node: last.node, offset: (last.node.nodeValue || "").length };
  }
  function findTextRange(text){
    text = String(text || "");
    if (!text || !document.body) return null;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var full = "";
    var n;
    while ((n = walker.nextNode())){
      var value = n.nodeValue || "";
      if (!value) continue;
      nodes.push({ node: n, start: full.length, end: full.length + value.length });
      full += value;
    }
    var index = full.indexOf(text);
    if (index < 0) return null;
    var start = textPointForOffset(nodes, index);
    var end = textPointForOffset(nodes, index + text.length);
    if (!start || !end) return null;
    try {
      var range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range.collapsed ? null : range;
    } catch (e) {
      return null;
    }
  }
  function rectsFromRange(range){
    if (!range) return [];
    var out = [];
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++){
      var rc = rects[i];
      if (rc.width < 1 || rc.height < 1) continue;
      out.push({ x: rc.left + window.scrollX, y: rc.top + window.scrollY, width: rc.width, height: rc.height });
    }
    return out;
  }
  function highlightRects(shape, size){
    var out = [];
    if (shape.anchor && shape.anchor.kind === "text-range") out = rectsFromRange(rangeFromTextAnchor(shape.anchor));
    if (!out.length && shape.text) out = rectsFromRange(findTextRange(shape.text));
    if (out.length) return out.slice(0, 400);
    return (shape.rects || []).map(function(r){
      return { x: clamp01(r.x) * size.w, y: clamp01(r.y) * size.h, width: clamp01(r.width) * size.w, height: clamp01(r.height) * size.h };
    });
  }
  function renderMarker(m, size){
    var color = m.resolved ? "#a0782b" : "#0c6b58";
    var active = m.id && m.id === selectedId;
    var shape = m.shape || {};
    if (shape.type === "highlight"){
      highlightRects(shape, size).forEach(function(r){
        var el = document.createElement("div");
        el.style.cssText = "position:absolute;pointer-events:auto;cursor:pointer;border-radius:2px;";
        el.style.left = px(r.x);
        el.style.top = px(r.y);
        el.style.width = px(r.width);
        el.style.height = px(r.height);
        el.style.background = active ? "rgba(12,107,88,0.34)" : (m.resolved ? "rgba(160,120,43,0.20)" : "rgba(12,107,88,0.22)");
        el.style.boxShadow = "inset 0 -2px 0 " + color;
        bindSelect(el, m.id);
        layer.appendChild(el);
      });
      return;
    }
    if (shape.type === "region"){
      var box = document.createElement("div");
      box.style.cssText = "position:absolute;pointer-events:auto;cursor:pointer;border-radius:4px;";
      box.style.left = px(clamp01(shape.x) * size.w);
      box.style.top = px(clamp01(shape.y) * size.h);
      box.style.width = px(clamp01(shape.width) * size.w);
      box.style.height = px(clamp01(shape.height) * size.h);
      box.style.border = "2px solid " + color;
      box.style.background = "rgba(12,107,88,0.12)";
      bindSelect(box, m.id);
      layer.appendChild(box);
      return;
    }
    if (typeof shape.x !== "number") return;
    var point = anchoredPoint(shape, size);
    var pin = document.createElement("div");
    pin.style.cssText = "position:absolute;pointer-events:auto;cursor:pointer;width:24px;height:24px;border-radius:999px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%);box-shadow:0 6px 16px rgba(32,33,36,0.28);font:600 11px system-ui,sans-serif;color:#fff;";
    pin.style.left = px(point.x);
    pin.style.top = px(point.y);
    pin.style.background = color;
    pin.style.opacity = m.resolved ? "0.6" : "1";
    if (active) pin.style.outline = "3px solid rgba(12,107,88,0.28)";
    pin.textContent = m.label != null ? String(m.label) : "";
    bindSelect(pin, m.id);
    layer.appendChild(pin);
  }
  function render(){
    pendingRender = 0;
    var l = ensureLayer();
    l.innerHTML = "";
    var size = docSize();
    markers.forEach(function(m){ renderMarker(m, size); });
    if (draft) renderMarker({ shape: draft, id: null, resolved: false }, size);
  }
  function markerTargetRect(shape, size){
    if (!shape) return null;
    if (shape.type === "highlight"){
      var rects = highlightRects(shape, size);
      return rects.length ? rects[0] : null;
    }
    if (shape.type === "region"){
      return { x: clamp01(shape.x) * size.w, y: clamp01(shape.y) * size.h, width: clamp01(shape.width) * size.w, height: clamp01(shape.height) * size.h };
    }
    if (typeof shape.x === "number"){
      var point = anchoredPoint(shape, size);
      return { x: point.x, y: point.y, width: 1, height: 1 };
    }
    return null;
  }
  function scrollToMarker(id){
    if (!id) return;
    var size = docSize();
    var marker = null;
    for (var i = 0; i < markers.length; i++){
      if (markers[i] && markers[i].id === id){ marker = markers[i]; break; }
    }
    if (!marker) return;
    var rect = markerTargetRect(marker.shape, size);
    if (!rect) return;
    var targetLeft = Math.max(0, rect.x + rect.width / 2 - window.innerWidth / 2);
    var targetTop = Math.max(0, rect.y + rect.height / 2 - window.innerHeight / 2);
    var scroller = document.scrollingElement || document.documentElement;
    if (scroller) {
      scroller.scrollLeft = targetLeft;
      scroller.scrollTop = targetTop;
    }
    window.scrollTo(targetLeft, targetTop);
    scheduleRender();
  }
  function scheduleRender(){
    if (pendingRender) return;
    pendingRender = window.requestAnimationFrame(render);
  }
  function normPoint(clientX, clientY){
    var size = docSize();
    return { x: clamp01((clientX + window.scrollX) / size.w), y: clamp01((clientY + window.scrollY) / size.h) };
  }
  function pointShape(clientX, clientY, target){
    var p = normPoint(clientX, clientY);
    var shape = { type: "pin", x: p.x, y: p.y };
    var anchor = elementAnchor(clientX, clientY, target);
    if (anchor) shape.anchor = anchor;
    return shape;
  }
  function collectSelection(){
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var text = (sel.toString() || "").trim();
    if (!text) return null;
    var size = docSize();
    var out = [];
    var firstRange = sel.getRangeAt(0).cloneRange();
    for (var r = 0; r < sel.rangeCount; r++){
      var rects = sel.getRangeAt(r).getClientRects();
      for (var i = 0; i < rects.length; i++){
        var rc = rects[i];
        if (rc.width < 1 || rc.height < 1) continue;
        out.push({ x: clamp01((rc.left + window.scrollX) / size.w), y: clamp01((rc.top + window.scrollY) / size.h), width: clamp01(rc.width / size.w), height: clamp01(rc.height / size.h) });
      }
    }
    if (!out.length) return null;
    var shape = { type: "highlight", rects: out.slice(0, 400), text: text.slice(0, 2000) };
    var anchor = textAnchorFromRange(firstRange, text);
    if (anchor) shape.anchor = anchor;
    return shape;
  }
  function clearNativeSelection(){
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  }

  document.addEventListener("click", function(e){
    if (mode !== "comment") return;
    if (layer && layer.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    var shape = pointShape(e.clientX, e.clientY, e.target);
    post({ type: "point", x: shape.x, y: shape.y, shape: shape });
  }, true);

  document.addEventListener("mouseup", function(){
    if (mode !== "highlight") return;
    setTimeout(function(){
      var shape = collectSelection();
      if (shape) {
        post({ type: "selection", rects: shape.rects, text: shape.text, shape: shape });
        clearNativeSelection();
        setTimeout(clearNativeSelection, 0);
      }
    }, 0);
  });

  document.addEventListener("keydown", function(e){
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
    var shortcut = shortcutMode(e.key);
    if (!shortcut) return;
    e.preventDefault();
    post({ type: "shortcut", key: shortcut });
  }, true);

  window.addEventListener("message", function(e){
    var d = e.data || {};
    if (!d || d.source !== HOST) return;
    if (d.type === "mode"){
      mode = d.mode || "browse";
      setCursor();
    } else if (d.type === "state"){
      if (d.mode){ mode = d.mode; setCursor(); }
      markers = d.markers || [];
      selectedId = d.selectedId || null;
      draft = d.draft || null;
      scheduleRender();
    } else if (d.type === "scrollTo"){
      selectedId = d.id || selectedId;
      scrollToMarker(d.id);
    }
  });

  window.addEventListener("resize", scheduleRender);
  window.addEventListener("load", scheduleRender);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRender).catch(function(){});
  if (window.ResizeObserver){
    var observer = new ResizeObserver(scheduleRender);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  post({ type: "ready" });
})();</script>`;

export function injectAnnotationBridge(html: string): string {
  if (html.includes("data-opendrop-bridge")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${ANNOTATION_BRIDGE}</body>`);
  return html + ANNOTATION_BRIDGE;
}

export function rewritePreviewHtml(html: string, previewBasePath: string): string {
  const base = previewBasePath.endsWith("/") ? previewBasePath : `${previewBasePath}/`;
  return html
    .replace(/\b(src|href|poster|action)=(["'])\/(?!\/)([^"']*)\2/gi, (_match, attr: string, quote: string, path: string) => {
      return `${attr}=${quote}${base}${path}${quote}`;
    })
    .replace(/url\(\s*(["']?)\/(?!\/)([^"')]+)\1\s*\)/gi, (_match, quote: string, path: string) => {
      return `url(${quote}${base}${path}${quote})`;
    });
}
