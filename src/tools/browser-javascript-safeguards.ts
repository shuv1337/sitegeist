
// Security safeguards function - will be converted to string with .toString()
function securitySafeguards() {
	// Lock down access to sensitive APIs by deleting them from window
	delete (window as any).localStorage;
	delete (window as any).sessionStorage;
	delete (window as any).indexedDB;
	delete (window as any).fetch;
	delete (window as any).XMLHttpRequest;
	delete (window as any).WebSocket;
	delete (window as any).EventSource;
	delete (window as any).caches;
	delete (window as any).cookieStore;

	// Block WebRTC for network exfiltration prevention
	delete (window as any).RTCPeerConnection;
	delete (window as any).RTCDataChannel;
	delete (window as any).RTCSessionDescription;
	delete (window as any).RTCIceCandidate;
	delete (window as any).webkitRTCPeerConnection;

	// CRITICAL: Block iframe and window creation to prevent API bypass via iframe.contentWindow
	const blockedError = () => {
		throw new Error("Creating new browsing contexts is blocked for security");
	};
	delete (window as any).HTMLIFrameElement;
	delete (window as any).HTMLFrameElement;
	delete (window as any).HTMLObjectElement;
	delete (window as any).HTMLEmbedElement;
	(window as any).open = blockedError;
	(window as any).showModalDialog = blockedError;

	// Block document.createElement for iframes, frames, objects, embeds
	const originalCreateElement = document.createElement.bind(document);
	document.createElement = ((tagName: string, options?: any) => {
		const tag = tagName.toLowerCase();
		if (
			tag === "iframe" ||
			tag === "frame" ||
			tag === "object" ||
			tag === "embed"
		) {
			throw new Error(`Creating ${tag} elements is blocked for security`);
		}
		return originalCreateElement(tagName, options);
	}) as any;

	// Block createElementNS (for SVG/XML iframes)
	const originalCreateElementNS = document.createElementNS.bind(document);
	document.createElementNS = ((
		namespaceURI: string,
		qualifiedName: string,
		options?: any,
	) => {
		const tag = qualifiedName.toLowerCase();
		if (
			tag === "iframe" ||
			tag === "frame" ||
			tag === "object" ||
			tag === "embed"
		) {
			throw new Error(`Creating ${tag} elements is blocked for security`);
		}
		return originalCreateElementNS(namespaceURI, qualifiedName, options);
	}) as any;

	// Block innerHTML/outerHTML that could inject iframes
	const blockIframeHTML = (value: string) => {
		if (typeof value === "string" && /<i?frame|<object|<embed/i.test(value)) {
			throw new Error(
				"HTML containing iframe/frame/object/embed is blocked for security",
			);
		}
		return value;
	};

	// Override Element.prototype.innerHTML setter
	const originalInnerHTMLDesc = Object.getOwnPropertyDescriptor(
		Element.prototype,
		"innerHTML",
	)!;
	Object.defineProperty(Element.prototype, "innerHTML", {
		set: function (value: string) {
			blockIframeHTML(value);
			originalInnerHTMLDesc.set?.call(this, value);
		},
		get: originalInnerHTMLDesc.get,
	});

	// Override Element.prototype.outerHTML setter
	const originalOuterHTMLDesc = Object.getOwnPropertyDescriptor(
		Element.prototype,
		"outerHTML",
	)!;
	Object.defineProperty(Element.prototype, "outerHTML", {
		set: function (value: string) {
			blockIframeHTML(value);
			originalOuterHTMLDesc.set?.call(this, value);
		},
		get: originalOuterHTMLDesc.get,
	});

	// Block insertAdjacentHTML
	const originalInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
	Element.prototype.insertAdjacentHTML = function (
		position: InsertPosition,
		html: string,
	) {
		blockIframeHTML(html);
		return originalInsertAdjacentHTML.call(this, position, html);
	};

	// Block document.write/writeln which could inject iframes
	(document as any).write = blockedError;
	(document as any).writeln = blockedError;

	// CRITICAL: Block modification of existing iframe src to prevent exfiltration via navigation
	try {
		const existingIframes = document.querySelectorAll(
			"iframe, frame, object, embed",
		);
		existingIframes.forEach((element) => {
			try {
				// Make src property read-only
				Object.defineProperty(element, "src", {
					get: function () {
						return this.getAttribute("src");
					},
					set: () => {
						throw new Error(
							"Modifying iframe/frame/object/embed src is blocked for security",
						);
					},
					configurable: false,
				});

				// Also block setAttribute for src
				const originalSetAttribute = element.setAttribute.bind(element);
				element.setAttribute = (name: string, value: string) => {
					if (name.toLowerCase() === "src") {
						throw new Error(
							"Modifying iframe/frame/object/embed src is blocked for security",
						);
					}
					return originalSetAttribute(name, value);
				};
			} catch (_e) {
				// Ignore errors for individual elements (may be cross-origin or protected)
			}
		});
	} catch (_e) {
		// Ignore if querySelectorAll fails
	}

	// Also block document.cookie access
	Object.defineProperty(document, "cookie", {
		get: () => {
			throw new Error("Access to document.cookie is blocked for security");
		},
		set: () => {
			throw new Error("Access to document.cookie is blocked for security");
		},
	});
}