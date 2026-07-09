interface OpenDropWindow extends Window {
  __opendropBridge?: boolean;
}

type BridgeMode = "browse" | "comment" | "highlight";

interface BridgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElementAnchor {
  kind: "element";
  selector: string;
  x: number;
  y: number;
}

interface TextAnchor {
  kind: "text-range";
  startPath: string;
  startOffset: number;
  endPath: string;
  endOffset: number;
  quote: string;
}

type BridgeAnchor = ElementAnchor | TextAnchor;

interface BridgeShape {
  type?: "pin" | "note" | "highlight" | "region" | "freehand";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rects?: BridgeRect[];
  text?: string;
  anchor?: BridgeAnchor;
}

interface BridgeMarker {
  id?: string | null;
  shape?: BridgeShape;
  resolved?: boolean;
  label?: number | null;
}

interface BridgeMessage {
  source?: string;
  type?: string;
  mode?: BridgeMode;
  markers?: BridgeMarker[];
  selectedId?: string | null;
  draft?: BridgeShape | null;
  id?: string;
  key?: string;
  x?: number;
  y?: number;
  rects?: BridgeRect[];
  text?: string;
  shape?: BridgeShape;
}

interface TextNodeRange {
  node: Text;
  start: number;
  end: number;
}

export function installOpenDropBridge() {
  const bridgeWindow = window as OpenDropWindow;
  if (bridgeWindow.__opendropBridge) return;
  bridgeWindow.__opendropBridge = true;

  const HOST = "opendrop-host";
  const SELF = "opendrop-preview";
  let mode: BridgeMode = "browse";
  let markers: BridgeMarker[] = [];
  let selectedId: string | null = null;
  let draft: BridgeShape | null = null;
  let layer: HTMLDivElement | null = null;
  let pendingRender = 0;

  function post(message: BridgeMessage) {
    message.source = SELF;
    try {
      parent.postMessage(message, "*");
    } catch {
      // The host may have navigated away while the preview is unloading.
    }
  }

  function clamp01(value: unknown): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.min(1, Math.max(0, numberValue)) : 0;
  }

  function docSize() {
    const doc = document.documentElement;
    const body = document.body || doc;
    return {
      w: Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth, 1),
      h: Math.max(doc.scrollHeight, body.scrollHeight, doc.clientHeight, 1)
    };
  }

  function ensureLayer(): HTMLDivElement {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.setAttribute("data-opendrop-layer", "");
    layer.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483000;pointer-events:none;";
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }

  function px(value: number): string {
    return `${value}px`;
  }

  function setCursor() {
    if (!document.body) return;
    document.body.style.cursor = mode === "comment" ? "crosshair" : mode === "highlight" ? "text" : "";
  }

  function shortcutMode(key: unknown): BridgeMode | null {
    const normalized = String(key || "").toLowerCase();
    if (normalized === "b") return "browse";
    if (normalized === "c") return "comment";
    if (normalized === "h") return "highlight";
    return null;
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    let element = target instanceof Element ? target : null;
    while (element) {
      const tag = element.tagName ? element.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (element as HTMLElement).isContentEditable) return true;
      element = element.parentElement;
    }
    return false;
  }

  function bindSelect(element: HTMLElement, id: string | null | undefined) {
    if (!id) return;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      post({ type: "select", id });
    });
  }

  function nodePath(node: Node | null): string | null {
    if (!node || !document.body) return null;
    if (node !== document.body && !document.body.contains(node)) return null;
    const parts: number[] = [];
    let current: Node | null = node;
    while (current && current !== document.body) {
      const parentNode: Node | null = current.parentNode;
      if (!parentNode) return null;
      let index = 0;
      let child = parentNode.firstChild;
      while (child && child !== current) {
        index++;
        child = child.nextSibling;
      }
      if (!child) return null;
      parts.unshift(index);
      current = parentNode;
    }
    return parts.join("/");
  }

  function nodeFromPath(path: string): Node | null {
    let node: Node | null = document.body;
    if (!node) return null;
    if (!path) return node;
    for (const part of String(path).split("/")) {
      const index = Number(part);
      if (!Number.isInteger(index) || !node.childNodes || index < 0 || index >= node.childNodes.length) return null;
      node = node.childNodes[index];
    }
    return node;
  }

  function nodeMaxOffset(node: Node | null): number {
    if (!node) return 0;
    return node.nodeType === Node.TEXT_NODE ? (node.nodeValue || "").length : node.childNodes.length;
  }

  function elementPath(element: Element | null): string | null {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || !document.body || !document.body.contains(element)) return null;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.localName;
      if (!tag) return null;
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.localName === tag) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return parts.length ? `body>${parts.join(">")}` : null;
  }

  function elementFromPath(selector: string): Element | null {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function anchorableElement(target: EventTarget | null, clientX: number, clientY: number): Element | null {
    let element = target instanceof Element ? target : document.elementFromPoint(clientX, clientY);
    if (element && layer && layer.contains(element)) return null;
    while (element && element.nodeType === Node.ELEMENT_NODE && element !== document.body && element !== document.documentElement) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (rect.width >= 4 && rect.height >= 4 && style.display !== "contents") return element;
      element = element.parentElement;
    }
    return null;
  }

  function elementAnchor(clientX: number, clientY: number, target: EventTarget | null): ElementAnchor | null {
    const element = anchorableElement(target, clientX, clientY);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const selector = elementPath(element);
    if (!selector || rect.width < 1 || rect.height < 1) return null;
    return { kind: "element", selector, x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
  }

  function anchoredPoint(shape: BridgeShape, size: { w: number; h: number }) {
    const anchor = shape.anchor;
    if (anchor?.kind === "element") {
      const element = elementFromPath(anchor.selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.width >= 1 && rect.height >= 1) {
          return { x: rect.left + window.scrollX + clamp01(anchor.x) * rect.width, y: rect.top + window.scrollY + clamp01(anchor.y) * rect.height };
        }
      }
    }
    return { x: clamp01(shape.x) * size.w, y: clamp01(shape.y) * size.h };
  }

  function normalizedText(value: unknown): string {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function textAnchorFromRange(range: Range, text: string): TextAnchor | null {
    const startPath = nodePath(range.startContainer);
    const endPath = nodePath(range.endContainer);
    if (startPath == null || endPath == null) return null;
    return {
      kind: "text-range",
      startPath,
      startOffset: Math.max(0, range.startOffset || 0),
      endPath,
      endOffset: Math.max(0, range.endOffset || 0),
      quote: String(text || "").slice(0, 2000)
    };
  }

  function rangeFromTextAnchor(anchor: BridgeAnchor | undefined): Range | null {
    if (!anchor || anchor.kind !== "text-range") return null;
    const start = nodeFromPath(anchor.startPath);
    const end = nodeFromPath(anchor.endPath);
    if (!start || !end) return null;
    try {
      const range = document.createRange();
      range.setStart(start, Math.min(Math.max(0, anchor.startOffset || 0), nodeMaxOffset(start)));
      range.setEnd(end, Math.min(Math.max(0, anchor.endOffset || 0), nodeMaxOffset(end)));
      if (range.collapsed) return null;
      const expected = normalizedText(anchor.quote);
      if (expected && normalizedText(range.toString()) !== expected) return null;
      return range;
    } catch {
      return null;
    }
  }

  function textPointForOffset(nodes: TextNodeRange[], offset: number): { node: Text; offset: number } | null {
    for (const item of nodes) {
      if (offset >= item.start && offset <= item.end) {
        return { node: item.node, offset: Math.min(Math.max(0, offset - item.start), item.node.data.length) };
      }
    }
    if (!nodes.length) return null;
    const last = nodes[nodes.length - 1];
    return { node: last.node, offset: last.node.data.length };
  }

  function findTextRange(text: string | undefined): Range | null {
    const query = String(text || "");
    if (!query || !document.body) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: TextNodeRange[] = [];
    let full = "";
    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const value = textNode.data || "";
      if (value) {
        nodes.push({ node: textNode, start: full.length, end: full.length + value.length });
        full += value;
      }
      node = walker.nextNode();
    }
    const index = full.indexOf(query);
    if (index < 0) return null;
    const start = textPointForOffset(nodes, index);
    const end = textPointForOffset(nodes, index + query.length);
    if (!start || !end) return null;
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range.collapsed ? null : range;
    } catch {
      return null;
    }
  }

  function rectsFromRange(range: Range | null): BridgeRect[] {
    if (!range) return [];
    const out: BridgeRect[] = [];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1 || rect.height < 1) continue;
      out.push({ x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height });
    }
    return out;
  }

  function highlightRects(shape: BridgeShape, size: { w: number; h: number }): BridgeRect[] {
    let out: BridgeRect[] = [];
    if (shape.anchor?.kind === "text-range") out = rectsFromRange(rangeFromTextAnchor(shape.anchor));
    if (!out.length && shape.text) out = rectsFromRange(findTextRange(shape.text));
    if (out.length) return out.slice(0, 400);
    return (shape.rects || []).map((rect) => ({
      x: clamp01(rect.x) * size.w,
      y: clamp01(rect.y) * size.h,
      width: clamp01(rect.width) * size.w,
      height: clamp01(rect.height) * size.h
    }));
  }

  function renderMarker(marker: BridgeMarker, size: { w: number; h: number }) {
    const color = marker.resolved ? "#a0782b" : "#0c6b58";
    const active = Boolean(marker.id && marker.id === selectedId);
    const shape = marker.shape || {};
    const markerLayer = ensureLayer();
    if (shape.type === "highlight") {
      highlightRects(shape, size).forEach((rect) => {
        const element = document.createElement("div");
        element.style.cssText = "position:absolute;pointer-events:auto;cursor:pointer;border-radius:2px;";
        element.style.left = px(rect.x);
        element.style.top = px(rect.y);
        element.style.width = px(rect.width);
        element.style.height = px(rect.height);
        element.style.background = active ? "rgba(12,107,88,0.34)" : marker.resolved ? "rgba(160,120,43,0.20)" : "rgba(12,107,88,0.22)";
        element.style.boxShadow = `inset 0 -2px 0 ${color}`;
        bindSelect(element, marker.id);
        markerLayer.appendChild(element);
      });
      return;
    }
    if (shape.type === "region") {
      const box = document.createElement("div");
      box.style.cssText = "position:absolute;pointer-events:auto;cursor:pointer;border-radius:4px;";
      box.style.left = px(clamp01(shape.x) * size.w);
      box.style.top = px(clamp01(shape.y) * size.h);
      box.style.width = px(clamp01(shape.width) * size.w);
      box.style.height = px(clamp01(shape.height) * size.h);
      box.style.border = `2px solid ${color}`;
      box.style.background = "rgba(12,107,88,0.12)";
      bindSelect(box, marker.id);
      markerLayer.appendChild(box);
      return;
    }
    if (typeof shape.x !== "number") return;
    const point = anchoredPoint(shape, size);
    const pin = document.createElement("div");
    pin.style.cssText = "position:absolute;pointer-events:auto;cursor:pointer;width:24px;height:24px;border-radius:999px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%);box-shadow:0 6px 16px rgba(32,33,36,0.28);font:600 11px system-ui,sans-serif;color:#fff;";
    pin.style.left = px(point.x);
    pin.style.top = px(point.y);
    pin.style.background = color;
    pin.style.opacity = marker.resolved ? "0.6" : "1";
    if (active) pin.style.outline = "3px solid rgba(12,107,88,0.28)";
    pin.textContent = marker.label != null ? String(marker.label) : "";
    bindSelect(pin, marker.id);
    markerLayer.appendChild(pin);
  }

  function render() {
    pendingRender = 0;
    const markerLayer = ensureLayer();
    markerLayer.innerHTML = "";
    const size = docSize();
    markers.forEach((marker) => renderMarker(marker, size));
    if (draft) renderMarker({ shape: draft, id: null, resolved: false }, size);
  }

  function markerTargetRect(shape: BridgeShape | undefined, size: { w: number; h: number }): BridgeRect | null {
    if (!shape) return null;
    if (shape.type === "highlight") {
      const rects = highlightRects(shape, size);
      return rects.length ? rects[0] : null;
    }
    if (shape.type === "region") {
      return { x: clamp01(shape.x) * size.w, y: clamp01(shape.y) * size.h, width: clamp01(shape.width) * size.w, height: clamp01(shape.height) * size.h };
    }
    if (typeof shape.x === "number") {
      const point = anchoredPoint(shape, size);
      return { x: point.x, y: point.y, width: 1, height: 1 };
    }
    return null;
  }

  function scrollToMarker(id: string | undefined) {
    if (!id) return;
    const size = docSize();
    const marker = markers.find((item) => item.id === id);
    if (!marker) return;
    const rect = markerTargetRect(marker.shape, size);
    if (!rect) return;
    const targetLeft = Math.max(0, rect.x + rect.width / 2 - window.innerWidth / 2);
    const targetTop = Math.max(0, rect.y + rect.height / 2 - window.innerHeight / 2);
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) {
      scroller.scrollLeft = targetLeft;
      scroller.scrollTop = targetTop;
    }
    window.scrollTo(targetLeft, targetTop);
    scheduleRender();
  }

  function scheduleRender() {
    if (pendingRender) return;
    pendingRender = window.requestAnimationFrame(render);
  }

  function normPoint(clientX: number, clientY: number) {
    const size = docSize();
    return { x: clamp01((clientX + window.scrollX) / size.w), y: clamp01((clientY + window.scrollY) / size.h) };
  }

  function pointShape(clientX: number, clientY: number, target: EventTarget | null): BridgeShape {
    const point = normPoint(clientX, clientY);
    const shape: BridgeShape = { type: "pin", x: point.x, y: point.y };
    const anchor = elementAnchor(clientX, clientY, target);
    if (anchor) shape.anchor = anchor;
    return shape;
  }

  function collectSelection(): BridgeShape | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = (selection.toString() || "").trim();
    if (!text) return null;
    const size = docSize();
    const out: BridgeRect[] = [];
    const firstRange = selection.getRangeAt(0).cloneRange();
    for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex++) {
      for (const rect of Array.from(selection.getRangeAt(rangeIndex).getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        out.push({ x: clamp01((rect.left + window.scrollX) / size.w), y: clamp01((rect.top + window.scrollY) / size.h), width: clamp01(rect.width / size.w), height: clamp01(rect.height / size.h) });
      }
    }
    if (!out.length) return null;
    const shape: BridgeShape = { type: "highlight", rects: out.slice(0, 400), text: text.slice(0, 2000) };
    const anchor = textAnchorFromRange(firstRange, text);
    if (anchor) shape.anchor = anchor;
    return shape;
  }

  function clearNativeSelection() {
    const selection = window.getSelection?.();
    if (selection?.removeAllRanges) selection.removeAllRanges();
  }

  document.addEventListener(
    "click",
    (event) => {
      if (mode !== "comment") return;
      if (layer && layer.contains(event.target as Node | null)) return;
      event.preventDefault();
      event.stopPropagation();
      const shape = pointShape(event.clientX, event.clientY, event.target);
      post({ type: "point", x: shape.x, y: shape.y, shape });
    },
    true
  );

  document.addEventListener("mouseup", () => {
    if (mode !== "highlight") return;
    setTimeout(() => {
      const shape = collectSelection();
      if (shape) {
        post({ type: "selection", rects: shape.rects, text: shape.text, shape });
        clearNativeSelection();
        setTimeout(clearNativeSelection, 0);
      }
    }, 0);
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      const shortcut = shortcutMode(event.key);
      if (!shortcut) return;
      event.preventDefault();
      post({ type: "shortcut", key: event.key });
    },
    true
  );

  window.addEventListener("message", (event) => {
    const data = (event.data || {}) as BridgeMessage;
    if (!data || data.source !== HOST) return;
    if (data.type === "mode") {
      mode = data.mode || "browse";
      setCursor();
    } else if (data.type === "state") {
      if (data.mode) {
        mode = data.mode;
        setCursor();
      }
      markers = data.markers || [];
      selectedId = data.selectedId || null;
      draft = data.draft || null;
      scheduleRender();
    } else if (data.type === "scrollTo") {
      selectedId = data.id || selectedId;
      scrollToMarker(data.id);
    }
  });

  window.addEventListener("resize", scheduleRender);
  window.addEventListener("load", scheduleRender);
  if (document.fonts?.ready) document.fonts.ready.then(scheduleRender).catch(() => undefined);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(scheduleRender);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  post({ type: "ready" });
}
