(function () {
    'use strict';

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * True if the custom elements polyfill is in use.
     */
    const isCEPolyfill = typeof window !== 'undefined' &&
        window.customElements != null &&
        window.customElements.polyfillWrapFlushCallback !==
            undefined;
    /**
     * Removes nodes, starting from `start` (inclusive) to `end` (exclusive), from
     * `container`.
     */
    const removeNodes = (container, start, end = null) => {
        while (start !== end) {
            const n = start.nextSibling;
            container.removeChild(start);
            start = n;
        }
    };

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * An expression marker with embedded unique key to avoid collision with
     * possible text in templates.
     */
    const marker = `{{lit-${String(Math.random()).slice(2)}}}`;
    /**
     * An expression marker used text-positions, multi-binding attributes, and
     * attributes with markup-like text values.
     */
    const nodeMarker = `<!--${marker}-->`;
    const markerRegex = new RegExp(`${marker}|${nodeMarker}`);
    /**
     * Suffix appended to all bound attribute names.
     */
    const boundAttributeSuffix = '$lit$';
    /**
     * An updatable Template that tracks the location of dynamic parts.
     */
    class Template {
        constructor(result, element) {
            this.parts = [];
            this.element = element;
            const nodesToRemove = [];
            const stack = [];
            // Edge needs all 4 parameters present; IE11 needs 3rd parameter to be null
            const walker = document.createTreeWalker(element.content, 133 /* NodeFilter.SHOW_{ELEMENT|COMMENT|TEXT} */, null, false);
            // Keeps track of the last index associated with a part. We try to delete
            // unnecessary nodes, but we never want to associate two different parts
            // to the same index. They must have a constant node between.
            let lastPartIndex = 0;
            let index = -1;
            let partIndex = 0;
            const { strings, values: { length } } = result;
            while (partIndex < length) {
                const node = walker.nextNode();
                if (node === null) {
                    // We've exhausted the content inside a nested template element.
                    // Because we still have parts (the outer for-loop), we know:
                    // - There is a template in the stack
                    // - The walker will find a nextNode outside the template
                    walker.currentNode = stack.pop();
                    continue;
                }
                index++;
                if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
                    if (node.hasAttributes()) {
                        const attributes = node.attributes;
                        const { length } = attributes;
                        // Per
                        // https://developer.mozilla.org/en-US/docs/Web/API/NamedNodeMap,
                        // attributes are not guaranteed to be returned in document order.
                        // In particular, Edge/IE can return them out of order, so we cannot
                        // assume a correspondence between part index and attribute index.
                        let count = 0;
                        for (let i = 0; i < length; i++) {
                            if (endsWith(attributes[i].name, boundAttributeSuffix)) {
                                count++;
                            }
                        }
                        while (count-- > 0) {
                            // Get the template literal section leading up to the first
                            // expression in this attribute
                            const stringForPart = strings[partIndex];
                            // Find the attribute name
                            const name = lastAttributeNameRegex.exec(stringForPart)[2];
                            // Find the corresponding attribute
                            // All bound attributes have had a suffix added in
                            // TemplateResult#getHTML to opt out of special attribute
                            // handling. To look up the attribute value we also need to add
                            // the suffix.
                            const attributeLookupName = name.toLowerCase() + boundAttributeSuffix;
                            const attributeValue = node.getAttribute(attributeLookupName);
                            node.removeAttribute(attributeLookupName);
                            const statics = attributeValue.split(markerRegex);
                            this.parts.push({ type: 'attribute', index, name, strings: statics });
                            partIndex += statics.length - 1;
                        }
                    }
                    if (node.tagName === 'TEMPLATE') {
                        stack.push(node);
                        walker.currentNode = node.content;
                    }
                }
                else if (node.nodeType === 3 /* Node.TEXT_NODE */) {
                    const data = node.data;
                    if (data.indexOf(marker) >= 0) {
                        const parent = node.parentNode;
                        const strings = data.split(markerRegex);
                        const lastIndex = strings.length - 1;
                        // Generate a new text node for each literal section
                        // These nodes are also used as the markers for node parts
                        for (let i = 0; i < lastIndex; i++) {
                            let insert;
                            let s = strings[i];
                            if (s === '') {
                                insert = createMarker();
                            }
                            else {
                                const match = lastAttributeNameRegex.exec(s);
                                if (match !== null && endsWith(match[2], boundAttributeSuffix)) {
                                    s = s.slice(0, match.index) + match[1] +
                                        match[2].slice(0, -boundAttributeSuffix.length) + match[3];
                                }
                                insert = document.createTextNode(s);
                            }
                            parent.insertBefore(insert, node);
                            this.parts.push({ type: 'node', index: ++index });
                        }
                        // If there's no text, we must insert a comment to mark our place.
                        // Else, we can trust it will stick around after cloning.
                        if (strings[lastIndex] === '') {
                            parent.insertBefore(createMarker(), node);
                            nodesToRemove.push(node);
                        }
                        else {
                            node.data = strings[lastIndex];
                        }
                        // We have a part for each match found
                        partIndex += lastIndex;
                    }
                }
                else if (node.nodeType === 8 /* Node.COMMENT_NODE */) {
                    if (node.data === marker) {
                        const parent = node.parentNode;
                        // Add a new marker node to be the startNode of the Part if any of
                        // the following are true:
                        //  * We don't have a previousSibling
                        //  * The previousSibling is already the start of a previous part
                        if (node.previousSibling === null || index === lastPartIndex) {
                            index++;
                            parent.insertBefore(createMarker(), node);
                        }
                        lastPartIndex = index;
                        this.parts.push({ type: 'node', index });
                        // If we don't have a nextSibling, keep this node so we have an end.
                        // Else, we can remove it to save future costs.
                        if (node.nextSibling === null) {
                            node.data = '';
                        }
                        else {
                            nodesToRemove.push(node);
                            index--;
                        }
                        partIndex++;
                    }
                    else {
                        let i = -1;
                        while ((i = node.data.indexOf(marker, i + 1)) !== -1) {
                            // Comment node has a binding marker inside, make an inactive part
                            // The binding won't work, but subsequent bindings will
                            // TODO (justinfagnani): consider whether it's even worth it to
                            // make bindings in comments work
                            this.parts.push({ type: 'node', index: -1 });
                            partIndex++;
                        }
                    }
                }
            }
            // Remove text binding nodes after the walk to not disturb the TreeWalker
            for (const n of nodesToRemove) {
                n.parentNode.removeChild(n);
            }
        }
    }
    const endsWith = (str, suffix) => {
        const index = str.length - suffix.length;
        return index >= 0 && str.slice(index) === suffix;
    };
    const isTemplatePartActive = (part) => part.index !== -1;
    // Allows `document.createComment('')` to be renamed for a
    // small manual size-savings.
    const createMarker = () => document.createComment('');
    /**
     * This regex extracts the attribute name preceding an attribute-position
     * expression. It does this by matching the syntax allowed for attributes
     * against the string literal directly preceding the expression, assuming that
     * the expression is in an attribute-value position.
     *
     * See attributes in the HTML spec:
     * https://www.w3.org/TR/html5/syntax.html#elements-attributes
     *
     * " \x09\x0a\x0c\x0d" are HTML space characters:
     * https://www.w3.org/TR/html5/infrastructure.html#space-characters
     *
     * "\0-\x1F\x7F-\x9F" are Unicode control characters, which includes every
     * space character except " ".
     *
     * So an attribute is:
     *  * The name: any character except a control character, space character, ('),
     *    ("), ">", "=", or "/"
     *  * Followed by zero or more space characters
     *  * Followed by "="
     *  * Followed by zero or more space characters
     *  * Followed by:
     *    * Any character except space, ('), ("), "<", ">", "=", (`), or
     *    * (") then any non-("), or
     *    * (') then any non-(')
     */
    const lastAttributeNameRegex = 
    // eslint-disable-next-line no-control-regex
    /([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/;

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    const walkerNodeFilter = 133 /* NodeFilter.SHOW_{ELEMENT|COMMENT|TEXT} */;
    /**
     * Removes the list of nodes from a Template safely. In addition to removing
     * nodes from the Template, the Template part indices are updated to match
     * the mutated Template DOM.
     *
     * As the template is walked the removal state is tracked and
     * part indices are adjusted as needed.
     *
     * div
     *   div#1 (remove) <-- start removing (removing node is div#1)
     *     div
     *       div#2 (remove)  <-- continue removing (removing node is still div#1)
     *         div
     * div <-- stop removing since previous sibling is the removing node (div#1,
     * removed 4 nodes)
     */
    function removeNodesFromTemplate(template, nodesToRemove) {
        const { element: { content }, parts } = template;
        const walker = document.createTreeWalker(content, walkerNodeFilter, null, false);
        let partIndex = nextActiveIndexInTemplateParts(parts);
        let part = parts[partIndex];
        let nodeIndex = -1;
        let removeCount = 0;
        const nodesToRemoveInTemplate = [];
        let currentRemovingNode = null;
        while (walker.nextNode()) {
            nodeIndex++;
            const node = walker.currentNode;
            // End removal if stepped past the removing node
            if (node.previousSibling === currentRemovingNode) {
                currentRemovingNode = null;
            }
            // A node to remove was found in the template
            if (nodesToRemove.has(node)) {
                nodesToRemoveInTemplate.push(node);
                // Track node we're removing
                if (currentRemovingNode === null) {
                    currentRemovingNode = node;
                }
            }
            // When removing, increment count by which to adjust subsequent part indices
            if (currentRemovingNode !== null) {
                removeCount++;
            }
            while (part !== undefined && part.index === nodeIndex) {
                // If part is in a removed node deactivate it by setting index to -1 or
                // adjust the index as needed.
                part.index = currentRemovingNode !== null ? -1 : part.index - removeCount;
                // go to the next active part.
                partIndex = nextActiveIndexInTemplateParts(parts, partIndex);
                part = parts[partIndex];
            }
        }
        nodesToRemoveInTemplate.forEach((n) => n.parentNode.removeChild(n));
    }
    const countNodes = (node) => {
        let count = (node.nodeType === 11 /* Node.DOCUMENT_FRAGMENT_NODE */) ? 0 : 1;
        const walker = document.createTreeWalker(node, walkerNodeFilter, null, false);
        while (walker.nextNode()) {
            count++;
        }
        return count;
    };
    const nextActiveIndexInTemplateParts = (parts, startIndex = -1) => {
        for (let i = startIndex + 1; i < parts.length; i++) {
            const part = parts[i];
            if (isTemplatePartActive(part)) {
                return i;
            }
        }
        return -1;
    };
    /**
     * Inserts the given node into the Template, optionally before the given
     * refNode. In addition to inserting the node into the Template, the Template
     * part indices are updated to match the mutated Template DOM.
     */
    function insertNodeIntoTemplate(template, node, refNode = null) {
        const { element: { content }, parts } = template;
        // If there's no refNode, then put node at end of template.
        // No part indices need to be shifted in this case.
        if (refNode === null || refNode === undefined) {
            content.appendChild(node);
            return;
        }
        const walker = document.createTreeWalker(content, walkerNodeFilter, null, false);
        let partIndex = nextActiveIndexInTemplateParts(parts);
        let insertCount = 0;
        let walkerIndex = -1;
        while (walker.nextNode()) {
            walkerIndex++;
            const walkerNode = walker.currentNode;
            if (walkerNode === refNode) {
                insertCount = countNodes(node);
                refNode.parentNode.insertBefore(node, refNode);
            }
            while (partIndex !== -1 && parts[partIndex].index === walkerIndex) {
                // If we've inserted the node, simply adjust all subsequent parts
                if (insertCount > 0) {
                    while (partIndex !== -1) {
                        parts[partIndex].index += insertCount;
                        partIndex = nextActiveIndexInTemplateParts(parts, partIndex);
                    }
                    return;
                }
                partIndex = nextActiveIndexInTemplateParts(parts, partIndex);
            }
        }
    }

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    const directives = new WeakMap();
    const isDirective = (o) => {
        return typeof o === 'function' && directives.has(o);
    };

    /**
     * @license
     * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * A sentinel value that signals that a value was handled by a directive and
     * should not be written to the DOM.
     */
    const noChange = {};
    /**
     * A sentinel value that signals a NodePart to fully clear its content.
     */
    const nothing = {};

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * An instance of a `Template` that can be attached to the DOM and updated
     * with new values.
     */
    class TemplateInstance {
        constructor(template, processor, options) {
            this.__parts = [];
            this.template = template;
            this.processor = processor;
            this.options = options;
        }
        update(values) {
            let i = 0;
            for (const part of this.__parts) {
                if (part !== undefined) {
                    part.setValue(values[i]);
                }
                i++;
            }
            for (const part of this.__parts) {
                if (part !== undefined) {
                    part.commit();
                }
            }
        }
        _clone() {
            // There are a number of steps in the lifecycle of a template instance's
            // DOM fragment:
            //  1. Clone - create the instance fragment
            //  2. Adopt - adopt into the main document
            //  3. Process - find part markers and create parts
            //  4. Upgrade - upgrade custom elements
            //  5. Update - set node, attribute, property, etc., values
            //  6. Connect - connect to the document. Optional and outside of this
            //     method.
            //
            // We have a few constraints on the ordering of these steps:
            //  * We need to upgrade before updating, so that property values will pass
            //    through any property setters.
            //  * We would like to process before upgrading so that we're sure that the
            //    cloned fragment is inert and not disturbed by self-modifying DOM.
            //  * We want custom elements to upgrade even in disconnected fragments.
            //
            // Given these constraints, with full custom elements support we would
            // prefer the order: Clone, Process, Adopt, Upgrade, Update, Connect
            //
            // But Safari does not implement CustomElementRegistry#upgrade, so we
            // can not implement that order and still have upgrade-before-update and
            // upgrade disconnected fragments. So we instead sacrifice the
            // process-before-upgrade constraint, since in Custom Elements v1 elements
            // must not modify their light DOM in the constructor. We still have issues
            // when co-existing with CEv0 elements like Polymer 1, and with polyfills
            // that don't strictly adhere to the no-modification rule because shadow
            // DOM, which may be created in the constructor, is emulated by being placed
            // in the light DOM.
            //
            // The resulting order is on native is: Clone, Adopt, Upgrade, Process,
            // Update, Connect. document.importNode() performs Clone, Adopt, and Upgrade
            // in one step.
            //
            // The Custom Elements v1 polyfill supports upgrade(), so the order when
            // polyfilled is the more ideal: Clone, Process, Adopt, Upgrade, Update,
            // Connect.
            const fragment = isCEPolyfill ?
                this.template.element.content.cloneNode(true) :
                document.importNode(this.template.element.content, true);
            const stack = [];
            const parts = this.template.parts;
            // Edge needs all 4 parameters present; IE11 needs 3rd parameter to be null
            const walker = document.createTreeWalker(fragment, 133 /* NodeFilter.SHOW_{ELEMENT|COMMENT|TEXT} */, null, false);
            let partIndex = 0;
            let nodeIndex = 0;
            let part;
            let node = walker.nextNode();
            // Loop through all the nodes and parts of a template
            while (partIndex < parts.length) {
                part = parts[partIndex];
                if (!isTemplatePartActive(part)) {
                    this.__parts.push(undefined);
                    partIndex++;
                    continue;
                }
                // Progress the tree walker until we find our next part's node.
                // Note that multiple parts may share the same node (attribute parts
                // on a single element), so this loop may not run at all.
                while (nodeIndex < part.index) {
                    nodeIndex++;
                    if (node.nodeName === 'TEMPLATE') {
                        stack.push(node);
                        walker.currentNode = node.content;
                    }
                    if ((node = walker.nextNode()) === null) {
                        // We've exhausted the content inside a nested template element.
                        // Because we still have parts (the outer for-loop), we know:
                        // - There is a template in the stack
                        // - The walker will find a nextNode outside the template
                        walker.currentNode = stack.pop();
                        node = walker.nextNode();
                    }
                }
                // We've arrived at our part's node.
                if (part.type === 'node') {
                    const part = this.processor.handleTextExpression(this.options);
                    part.insertAfterNode(node.previousSibling);
                    this.__parts.push(part);
                }
                else {
                    this.__parts.push(...this.processor.handleAttributeExpressions(node, part.name, part.strings, this.options));
                }
                partIndex++;
            }
            if (isCEPolyfill) {
                document.adoptNode(fragment);
                customElements.upgrade(fragment);
            }
            return fragment;
        }
    }

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * Our TrustedTypePolicy for HTML which is declared using the html template
     * tag function.
     *
     * That HTML is a developer-authored constant, and is parsed with innerHTML
     * before any untrusted expressions have been mixed in. Therefor it is
     * considered safe by construction.
     */
    const policy = window.trustedTypes &&
        trustedTypes.createPolicy('lit-html', { createHTML: (s) => s });
    const commentMarker = ` ${marker} `;
    /**
     * The return type of `html`, which holds a Template and the values from
     * interpolated expressions.
     */
    class TemplateResult {
        constructor(strings, values, type, processor) {
            this.strings = strings;
            this.values = values;
            this.type = type;
            this.processor = processor;
        }
        /**
         * Returns a string of HTML used to create a `<template>` element.
         */
        getHTML() {
            const l = this.strings.length - 1;
            let html = '';
            let isCommentBinding = false;
            for (let i = 0; i < l; i++) {
                const s = this.strings[i];
                // For each binding we want to determine the kind of marker to insert
                // into the template source before it's parsed by the browser's HTML
                // parser. The marker type is based on whether the expression is in an
                // attribute, text, or comment position.
                //   * For node-position bindings we insert a comment with the marker
                //     sentinel as its text content, like <!--{{lit-guid}}-->.
                //   * For attribute bindings we insert just the marker sentinel for the
                //     first binding, so that we support unquoted attribute bindings.
                //     Subsequent bindings can use a comment marker because multi-binding
                //     attributes must be quoted.
                //   * For comment bindings we insert just the marker sentinel so we don't
                //     close the comment.
                //
                // The following code scans the template source, but is *not* an HTML
                // parser. We don't need to track the tree structure of the HTML, only
                // whether a binding is inside a comment, and if not, if it appears to be
                // the first binding in an attribute.
                const commentOpen = s.lastIndexOf('<!--');
                // We're in comment position if we have a comment open with no following
                // comment close. Because <-- can appear in an attribute value there can
                // be false positives.
                isCommentBinding = (commentOpen > -1 || isCommentBinding) &&
                    s.indexOf('-->', commentOpen + 1) === -1;
                // Check to see if we have an attribute-like sequence preceding the
                // expression. This can match "name=value" like structures in text,
                // comments, and attribute values, so there can be false-positives.
                const attributeMatch = lastAttributeNameRegex.exec(s);
                if (attributeMatch === null) {
                    // We're only in this branch if we don't have a attribute-like
                    // preceding sequence. For comments, this guards against unusual
                    // attribute values like <div foo="<!--${'bar'}">. Cases like
                    // <!-- foo=${'bar'}--> are handled correctly in the attribute branch
                    // below.
                    html += s + (isCommentBinding ? commentMarker : nodeMarker);
                }
                else {
                    // For attributes we use just a marker sentinel, and also append a
                    // $lit$ suffix to the name to opt-out of attribute-specific parsing
                    // that IE and Edge do for style and certain SVG attributes.
                    html += s.substr(0, attributeMatch.index) + attributeMatch[1] +
                        attributeMatch[2] + boundAttributeSuffix + attributeMatch[3] +
                        marker;
                }
            }
            html += this.strings[l];
            return html;
        }
        getTemplateElement() {
            const template = document.createElement('template');
            let value = this.getHTML();
            if (policy !== undefined) {
                // this is secure because `this.strings` is a TemplateStringsArray.
                // TODO: validate this when
                // https://github.com/tc39/proposal-array-is-template-object is
                // implemented.
                value = policy.createHTML(value);
            }
            template.innerHTML = value;
            return template;
        }
    }

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    const isPrimitive = (value) => {
        return (value === null ||
            !(typeof value === 'object' || typeof value === 'function'));
    };
    const isIterable = (value) => {
        return Array.isArray(value) ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            !!(value && value[Symbol.iterator]);
    };
    /**
     * Writes attribute values to the DOM for a group of AttributeParts bound to a
     * single attribute. The value is only set once even if there are multiple parts
     * for an attribute.
     */
    class AttributeCommitter {
        constructor(element, name, strings) {
            this.dirty = true;
            this.element = element;
            this.name = name;
            this.strings = strings;
            this.parts = [];
            for (let i = 0; i < strings.length - 1; i++) {
                this.parts[i] = this._createPart();
            }
        }
        /**
         * Creates a single part. Override this to create a differnt type of part.
         */
        _createPart() {
            return new AttributePart(this);
        }
        _getValue() {
            const strings = this.strings;
            const l = strings.length - 1;
            const parts = this.parts;
            // If we're assigning an attribute via syntax like:
            //    attr="${foo}"  or  attr=${foo}
            // but not
            //    attr="${foo} ${bar}" or attr="${foo} baz"
            // then we don't want to coerce the attribute value into one long
            // string. Instead we want to just return the value itself directly,
            // so that sanitizeDOMValue can get the actual value rather than
            // String(value)
            // The exception is if v is an array, in which case we do want to smash
            // it together into a string without calling String() on the array.
            //
            // This also allows trusted values (when using TrustedTypes) being
            // assigned to DOM sinks without being stringified in the process.
            if (l === 1 && strings[0] === '' && strings[1] === '') {
                const v = parts[0].value;
                if (typeof v === 'symbol') {
                    return String(v);
                }
                if (typeof v === 'string' || !isIterable(v)) {
                    return v;
                }
            }
            let text = '';
            for (let i = 0; i < l; i++) {
                text += strings[i];
                const part = parts[i];
                if (part !== undefined) {
                    const v = part.value;
                    if (isPrimitive(v) || !isIterable(v)) {
                        text += typeof v === 'string' ? v : String(v);
                    }
                    else {
                        for (const t of v) {
                            text += typeof t === 'string' ? t : String(t);
                        }
                    }
                }
            }
            text += strings[l];
            return text;
        }
        commit() {
            if (this.dirty) {
                this.dirty = false;
                this.element.setAttribute(this.name, this._getValue());
            }
        }
    }
    /**
     * A Part that controls all or part of an attribute value.
     */
    class AttributePart {
        constructor(committer) {
            this.value = undefined;
            this.committer = committer;
        }
        setValue(value) {
            if (value !== noChange && (!isPrimitive(value) || value !== this.value)) {
                this.value = value;
                // If the value is a not a directive, dirty the committer so that it'll
                // call setAttribute. If the value is a directive, it'll dirty the
                // committer if it calls setValue().
                if (!isDirective(value)) {
                    this.committer.dirty = true;
                }
            }
        }
        commit() {
            while (isDirective(this.value)) {
                const directive = this.value;
                this.value = noChange;
                directive(this);
            }
            if (this.value === noChange) {
                return;
            }
            this.committer.commit();
        }
    }
    /**
     * A Part that controls a location within a Node tree. Like a Range, NodePart
     * has start and end locations and can set and update the Nodes between those
     * locations.
     *
     * NodeParts support several value types: primitives, Nodes, TemplateResults,
     * as well as arrays and iterables of those types.
     */
    class NodePart {
        constructor(options) {
            this.value = undefined;
            this.__pendingValue = undefined;
            this.options = options;
        }
        /**
         * Appends this part into a container.
         *
         * This part must be empty, as its contents are not automatically moved.
         */
        appendInto(container) {
            this.startNode = container.appendChild(createMarker());
            this.endNode = container.appendChild(createMarker());
        }
        /**
         * Inserts this part after the `ref` node (between `ref` and `ref`'s next
         * sibling). Both `ref` and its next sibling must be static, unchanging nodes
         * such as those that appear in a literal section of a template.
         *
         * This part must be empty, as its contents are not automatically moved.
         */
        insertAfterNode(ref) {
            this.startNode = ref;
            this.endNode = ref.nextSibling;
        }
        /**
         * Appends this part into a parent part.
         *
         * This part must be empty, as its contents are not automatically moved.
         */
        appendIntoPart(part) {
            part.__insert(this.startNode = createMarker());
            part.__insert(this.endNode = createMarker());
        }
        /**
         * Inserts this part after the `ref` part.
         *
         * This part must be empty, as its contents are not automatically moved.
         */
        insertAfterPart(ref) {
            ref.__insert(this.startNode = createMarker());
            this.endNode = ref.endNode;
            ref.endNode = this.startNode;
        }
        setValue(value) {
            this.__pendingValue = value;
        }
        commit() {
            if (this.startNode.parentNode === null) {
                return;
            }
            while (isDirective(this.__pendingValue)) {
                const directive = this.__pendingValue;
                this.__pendingValue = noChange;
                directive(this);
            }
            const value = this.__pendingValue;
            if (value === noChange) {
                return;
            }
            if (isPrimitive(value)) {
                if (value !== this.value) {
                    this.__commitText(value);
                }
            }
            else if (value instanceof TemplateResult) {
                this.__commitTemplateResult(value);
            }
            else if (value instanceof Node) {
                this.__commitNode(value);
            }
            else if (isIterable(value)) {
                this.__commitIterable(value);
            }
            else if (value === nothing) {
                this.value = nothing;
                this.clear();
            }
            else {
                // Fallback, will render the string representation
                this.__commitText(value);
            }
        }
        __insert(node) {
            this.endNode.parentNode.insertBefore(node, this.endNode);
        }
        __commitNode(value) {
            if (this.value === value) {
                return;
            }
            this.clear();
            this.__insert(value);
            this.value = value;
        }
        __commitText(value) {
            const node = this.startNode.nextSibling;
            value = value == null ? '' : value;
            // If `value` isn't already a string, we explicitly convert it here in case
            // it can't be implicitly converted - i.e. it's a symbol.
            const valueAsString = typeof value === 'string' ? value : String(value);
            if (node === this.endNode.previousSibling &&
                node.nodeType === 3 /* Node.TEXT_NODE */) {
                // If we only have a single text node between the markers, we can just
                // set its value, rather than replacing it.
                // TODO(justinfagnani): Can we just check if this.value is primitive?
                node.data = valueAsString;
            }
            else {
                this.__commitNode(document.createTextNode(valueAsString));
            }
            this.value = value;
        }
        __commitTemplateResult(value) {
            const template = this.options.templateFactory(value);
            if (this.value instanceof TemplateInstance &&
                this.value.template === template) {
                this.value.update(value.values);
            }
            else {
                // Make sure we propagate the template processor from the TemplateResult
                // so that we use its syntax extension, etc. The template factory comes
                // from the render function options so that it can control template
                // caching and preprocessing.
                const instance = new TemplateInstance(template, value.processor, this.options);
                const fragment = instance._clone();
                instance.update(value.values);
                this.__commitNode(fragment);
                this.value = instance;
            }
        }
        __commitIterable(value) {
            // For an Iterable, we create a new InstancePart per item, then set its
            // value to the item. This is a little bit of overhead for every item in
            // an Iterable, but it lets us recurse easily and efficiently update Arrays
            // of TemplateResults that will be commonly returned from expressions like:
            // array.map((i) => html`${i}`), by reusing existing TemplateInstances.
            // If _value is an array, then the previous render was of an
            // iterable and _value will contain the NodeParts from the previous
            // render. If _value is not an array, clear this part and make a new
            // array for NodeParts.
            if (!Array.isArray(this.value)) {
                this.value = [];
                this.clear();
            }
            // Lets us keep track of how many items we stamped so we can clear leftover
            // items from a previous render
            const itemParts = this.value;
            let partIndex = 0;
            let itemPart;
            for (const item of value) {
                // Try to reuse an existing part
                itemPart = itemParts[partIndex];
                // If no existing part, create a new one
                if (itemPart === undefined) {
                    itemPart = new NodePart(this.options);
                    itemParts.push(itemPart);
                    if (partIndex === 0) {
                        itemPart.appendIntoPart(this);
                    }
                    else {
                        itemPart.insertAfterPart(itemParts[partIndex - 1]);
                    }
                }
                itemPart.setValue(item);
                itemPart.commit();
                partIndex++;
            }
            if (partIndex < itemParts.length) {
                // Truncate the parts array so _value reflects the current state
                itemParts.length = partIndex;
                this.clear(itemPart && itemPart.endNode);
            }
        }
        clear(startNode = this.startNode) {
            removeNodes(this.startNode.parentNode, startNode.nextSibling, this.endNode);
        }
    }
    /**
     * Implements a boolean attribute, roughly as defined in the HTML
     * specification.
     *
     * If the value is truthy, then the attribute is present with a value of
     * ''. If the value is falsey, the attribute is removed.
     */
    class BooleanAttributePart {
        constructor(element, name, strings) {
            this.value = undefined;
            this.__pendingValue = undefined;
            if (strings.length !== 2 || strings[0] !== '' || strings[1] !== '') {
                throw new Error('Boolean attributes can only contain a single expression');
            }
            this.element = element;
            this.name = name;
            this.strings = strings;
        }
        setValue(value) {
            this.__pendingValue = value;
        }
        commit() {
            while (isDirective(this.__pendingValue)) {
                const directive = this.__pendingValue;
                this.__pendingValue = noChange;
                directive(this);
            }
            if (this.__pendingValue === noChange) {
                return;
            }
            const value = !!this.__pendingValue;
            if (this.value !== value) {
                if (value) {
                    this.element.setAttribute(this.name, '');
                }
                else {
                    this.element.removeAttribute(this.name);
                }
                this.value = value;
            }
            this.__pendingValue = noChange;
        }
    }
    /**
     * Sets attribute values for PropertyParts, so that the value is only set once
     * even if there are multiple parts for a property.
     *
     * If an expression controls the whole property value, then the value is simply
     * assigned to the property under control. If there are string literals or
     * multiple expressions, then the strings are expressions are interpolated into
     * a string first.
     */
    class PropertyCommitter extends AttributeCommitter {
        constructor(element, name, strings) {
            super(element, name, strings);
            this.single =
                (strings.length === 2 && strings[0] === '' && strings[1] === '');
        }
        _createPart() {
            return new PropertyPart(this);
        }
        _getValue() {
            if (this.single) {
                return this.parts[0].value;
            }
            return super._getValue();
        }
        commit() {
            if (this.dirty) {
                this.dirty = false;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.element[this.name] = this._getValue();
            }
        }
    }
    class PropertyPart extends AttributePart {
    }
    // Detect event listener options support. If the `capture` property is read
    // from the options object, then options are supported. If not, then the third
    // argument to add/removeEventListener is interpreted as the boolean capture
    // value so we should only pass the `capture` property.
    let eventOptionsSupported = false;
    // Wrap into an IIFE because MS Edge <= v41 does not support having try/catch
    // blocks right into the body of a module
    (() => {
        try {
            const options = {
                get capture() {
                    eventOptionsSupported = true;
                    return false;
                }
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            window.addEventListener('test', options, options);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            window.removeEventListener('test', options, options);
        }
        catch (_e) {
            // event options not supported
        }
    })();
    class EventPart {
        constructor(element, eventName, eventContext) {
            this.value = undefined;
            this.__pendingValue = undefined;
            this.element = element;
            this.eventName = eventName;
            this.eventContext = eventContext;
            this.__boundHandleEvent = (e) => this.handleEvent(e);
        }
        setValue(value) {
            this.__pendingValue = value;
        }
        commit() {
            while (isDirective(this.__pendingValue)) {
                const directive = this.__pendingValue;
                this.__pendingValue = noChange;
                directive(this);
            }
            if (this.__pendingValue === noChange) {
                return;
            }
            const newListener = this.__pendingValue;
            const oldListener = this.value;
            const shouldRemoveListener = newListener == null ||
                oldListener != null &&
                    (newListener.capture !== oldListener.capture ||
                        newListener.once !== oldListener.once ||
                        newListener.passive !== oldListener.passive);
            const shouldAddListener = newListener != null && (oldListener == null || shouldRemoveListener);
            if (shouldRemoveListener) {
                this.element.removeEventListener(this.eventName, this.__boundHandleEvent, this.__options);
            }
            if (shouldAddListener) {
                this.__options = getOptions(newListener);
                this.element.addEventListener(this.eventName, this.__boundHandleEvent, this.__options);
            }
            this.value = newListener;
            this.__pendingValue = noChange;
        }
        handleEvent(event) {
            if (typeof this.value === 'function') {
                this.value.call(this.eventContext || this.element, event);
            }
            else {
                this.value.handleEvent(event);
            }
        }
    }
    // We copy options because of the inconsistent behavior of browsers when reading
    // the third argument of add/removeEventListener. IE11 doesn't support options
    // at all. Chrome 41 only reads `capture` if the argument is an object.
    const getOptions = (o) => o &&
        (eventOptionsSupported ?
            { capture: o.capture, passive: o.passive, once: o.once } :
            o.capture);

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * The default TemplateFactory which caches Templates keyed on
     * result.type and result.strings.
     */
    function templateFactory(result) {
        let templateCache = templateCaches.get(result.type);
        if (templateCache === undefined) {
            templateCache = {
                stringsArray: new WeakMap(),
                keyString: new Map()
            };
            templateCaches.set(result.type, templateCache);
        }
        let template = templateCache.stringsArray.get(result.strings);
        if (template !== undefined) {
            return template;
        }
        // If the TemplateStringsArray is new, generate a key from the strings
        // This key is shared between all templates with identical content
        const key = result.strings.join(marker);
        // Check if we already have a Template for this key
        template = templateCache.keyString.get(key);
        if (template === undefined) {
            // If we have not seen this key before, create a new Template
            template = new Template(result, result.getTemplateElement());
            // Cache the Template for this key
            templateCache.keyString.set(key, template);
        }
        // Cache all future queries for this TemplateStringsArray
        templateCache.stringsArray.set(result.strings, template);
        return template;
    }
    const templateCaches = new Map();

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    const parts = new WeakMap();
    /**
     * Renders a template result or other value to a container.
     *
     * To update a container with new values, reevaluate the template literal and
     * call `render` with the new result.
     *
     * @param result Any value renderable by NodePart - typically a TemplateResult
     *     created by evaluating a template tag like `html` or `svg`.
     * @param container A DOM parent to render to. The entire contents are either
     *     replaced, or efficiently updated if the same result type was previous
     *     rendered there.
     * @param options RenderOptions for the entire render tree rendered to this
     *     container. Render options must *not* change between renders to the same
     *     container, as those changes will not effect previously rendered DOM.
     */
    const render$1 = (result, container, options) => {
        let part = parts.get(container);
        if (part === undefined) {
            removeNodes(container, container.firstChild);
            parts.set(container, part = new NodePart(Object.assign({ templateFactory }, options)));
            part.appendInto(container);
        }
        part.setValue(result);
        part.commit();
    };

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    /**
     * Creates Parts when a template is instantiated.
     */
    class DefaultTemplateProcessor {
        /**
         * Create parts for an attribute-position binding, given the event, attribute
         * name, and string literals.
         *
         * @param element The element containing the binding
         * @param name  The attribute name
         * @param strings The string literals. There are always at least two strings,
         *   event for fully-controlled bindings with a single expression.
         */
        handleAttributeExpressions(element, name, strings, options) {
            const prefix = name[0];
            if (prefix === '.') {
                const committer = new PropertyCommitter(element, name.slice(1), strings);
                return committer.parts;
            }
            if (prefix === '@') {
                return [new EventPart(element, name.slice(1), options.eventContext)];
            }
            if (prefix === '?') {
                return [new BooleanAttributePart(element, name.slice(1), strings)];
            }
            const committer = new AttributeCommitter(element, name, strings);
            return committer.parts;
        }
        /**
         * Create parts for a text-position binding.
         * @param templateFactory
         */
        handleTextExpression(options) {
            return new NodePart(options);
        }
    }
    const defaultTemplateProcessor = new DefaultTemplateProcessor();

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    // IMPORTANT: do not change the property name or the assignment expression.
    // This line will be used in regexes to search for lit-html usage.
    // TODO(justinfagnani): inject version number at build time
    if (typeof window !== 'undefined') {
        (window['litHtmlVersions'] || (window['litHtmlVersions'] = [])).push('1.3.0');
    }
    /**
     * Interprets a template literal as an HTML template that can efficiently
     * render to and update a container.
     */
    const html = (strings, ...values) => new TemplateResult(strings, values, 'html', defaultTemplateProcessor);

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    // Get a key to lookup in `templateCaches`.
    const getTemplateCacheKey = (type, scopeName) => `${type}--${scopeName}`;
    let compatibleShadyCSSVersion = true;
    if (typeof window.ShadyCSS === 'undefined') {
        compatibleShadyCSSVersion = false;
    }
    else if (typeof window.ShadyCSS.prepareTemplateDom === 'undefined') {
        console.warn(`Incompatible ShadyCSS version detected. ` +
            `Please update to at least @webcomponents/webcomponentsjs@2.0.2 and ` +
            `@webcomponents/shadycss@1.3.1.`);
        compatibleShadyCSSVersion = false;
    }
    /**
     * Template factory which scopes template DOM using ShadyCSS.
     * @param scopeName {string}
     */
    const shadyTemplateFactory = (scopeName) => (result) => {
        const cacheKey = getTemplateCacheKey(result.type, scopeName);
        let templateCache = templateCaches.get(cacheKey);
        if (templateCache === undefined) {
            templateCache = {
                stringsArray: new WeakMap(),
                keyString: new Map()
            };
            templateCaches.set(cacheKey, templateCache);
        }
        let template = templateCache.stringsArray.get(result.strings);
        if (template !== undefined) {
            return template;
        }
        const key = result.strings.join(marker);
        template = templateCache.keyString.get(key);
        if (template === undefined) {
            const element = result.getTemplateElement();
            if (compatibleShadyCSSVersion) {
                window.ShadyCSS.prepareTemplateDom(element, scopeName);
            }
            template = new Template(result, element);
            templateCache.keyString.set(key, template);
        }
        templateCache.stringsArray.set(result.strings, template);
        return template;
    };
    const TEMPLATE_TYPES = ['html', 'svg'];
    /**
     * Removes all style elements from Templates for the given scopeName.
     */
    const removeStylesFromLitTemplates = (scopeName) => {
        TEMPLATE_TYPES.forEach((type) => {
            const templates = templateCaches.get(getTemplateCacheKey(type, scopeName));
            if (templates !== undefined) {
                templates.keyString.forEach((template) => {
                    const { element: { content } } = template;
                    // IE 11 doesn't support the iterable param Set constructor
                    const styles = new Set();
                    Array.from(content.querySelectorAll('style')).forEach((s) => {
                        styles.add(s);
                    });
                    removeNodesFromTemplate(template, styles);
                });
            }
        });
    };
    const shadyRenderSet = new Set();
    /**
     * For the given scope name, ensures that ShadyCSS style scoping is performed.
     * This is done just once per scope name so the fragment and template cannot
     * be modified.
     * (1) extracts styles from the rendered fragment and hands them to ShadyCSS
     * to be scoped and appended to the document
     * (2) removes style elements from all lit-html Templates for this scope name.
     *
     * Note, <style> elements can only be placed into templates for the
     * initial rendering of the scope. If <style> elements are included in templates
     * dynamically rendered to the scope (after the first scope render), they will
     * not be scoped and the <style> will be left in the template and rendered
     * output.
     */
    const prepareTemplateStyles = (scopeName, renderedDOM, template) => {
        shadyRenderSet.add(scopeName);
        // If `renderedDOM` is stamped from a Template, then we need to edit that
        // Template's underlying template element. Otherwise, we create one here
        // to give to ShadyCSS, which still requires one while scoping.
        const templateElement = !!template ? template.element : document.createElement('template');
        // Move styles out of rendered DOM and store.
        const styles = renderedDOM.querySelectorAll('style');
        const { length } = styles;
        // If there are no styles, skip unnecessary work
        if (length === 0) {
            // Ensure prepareTemplateStyles is called to support adding
            // styles via `prepareAdoptedCssText` since that requires that
            // `prepareTemplateStyles` is called.
            //
            // ShadyCSS will only update styles containing @apply in the template
            // given to `prepareTemplateStyles`. If no lit Template was given,
            // ShadyCSS will not be able to update uses of @apply in any relevant
            // template. However, this is not a problem because we only create the
            // template for the purpose of supporting `prepareAdoptedCssText`,
            // which doesn't support @apply at all.
            window.ShadyCSS.prepareTemplateStyles(templateElement, scopeName);
            return;
        }
        const condensedStyle = document.createElement('style');
        // Collect styles into a single style. This helps us make sure ShadyCSS
        // manipulations will not prevent us from being able to fix up template
        // part indices.
        // NOTE: collecting styles is inefficient for browsers but ShadyCSS
        // currently does this anyway. When it does not, this should be changed.
        for (let i = 0; i < length; i++) {
            const style = styles[i];
            style.parentNode.removeChild(style);
            condensedStyle.textContent += style.textContent;
        }
        // Remove styles from nested templates in this scope.
        removeStylesFromLitTemplates(scopeName);
        // And then put the condensed style into the "root" template passed in as
        // `template`.
        const content = templateElement.content;
        if (!!template) {
            insertNodeIntoTemplate(template, condensedStyle, content.firstChild);
        }
        else {
            content.insertBefore(condensedStyle, content.firstChild);
        }
        // Note, it's important that ShadyCSS gets the template that `lit-html`
        // will actually render so that it can update the style inside when
        // needed (e.g. @apply native Shadow DOM case).
        window.ShadyCSS.prepareTemplateStyles(templateElement, scopeName);
        const style = content.querySelector('style');
        if (window.ShadyCSS.nativeShadow && style !== null) {
            // When in native Shadow DOM, ensure the style created by ShadyCSS is
            // included in initially rendered output (`renderedDOM`).
            renderedDOM.insertBefore(style.cloneNode(true), renderedDOM.firstChild);
        }
        else if (!!template) {
            // When no style is left in the template, parts will be broken as a
            // result. To fix this, we put back the style node ShadyCSS removed
            // and then tell lit to remove that node from the template.
            // There can be no style in the template in 2 cases (1) when Shady DOM
            // is in use, ShadyCSS removes all styles, (2) when native Shadow DOM
            // is in use ShadyCSS removes the style if it contains no content.
            // NOTE, ShadyCSS creates its own style so we can safely add/remove
            // `condensedStyle` here.
            content.insertBefore(condensedStyle, content.firstChild);
            const removes = new Set();
            removes.add(condensedStyle);
            removeNodesFromTemplate(template, removes);
        }
    };
    /**
     * Extension to the standard `render` method which supports rendering
     * to ShadowRoots when the ShadyDOM (https://github.com/webcomponents/shadydom)
     * and ShadyCSS (https://github.com/webcomponents/shadycss) polyfills are used
     * or when the webcomponentsjs
     * (https://github.com/webcomponents/webcomponentsjs) polyfill is used.
     *
     * Adds a `scopeName` option which is used to scope element DOM and stylesheets
     * when native ShadowDOM is unavailable. The `scopeName` will be added to
     * the class attribute of all rendered DOM. In addition, any style elements will
     * be automatically re-written with this `scopeName` selector and moved out
     * of the rendered DOM and into the document `<head>`.
     *
     * It is common to use this render method in conjunction with a custom element
     * which renders a shadowRoot. When this is done, typically the element's
     * `localName` should be used as the `scopeName`.
     *
     * In addition to DOM scoping, ShadyCSS also supports a basic shim for css
     * custom properties (needed only on older browsers like IE11) and a shim for
     * a deprecated feature called `@apply` that supports applying a set of css
     * custom properties to a given location.
     *
     * Usage considerations:
     *
     * * Part values in `<style>` elements are only applied the first time a given
     * `scopeName` renders. Subsequent changes to parts in style elements will have
     * no effect. Because of this, parts in style elements should only be used for
     * values that will never change, for example parts that set scope-wide theme
     * values or parts which render shared style elements.
     *
     * * Note, due to a limitation of the ShadyDOM polyfill, rendering in a
     * custom element's `constructor` is not supported. Instead rendering should
     * either done asynchronously, for example at microtask timing (for example
     * `Promise.resolve()`), or be deferred until the first time the element's
     * `connectedCallback` runs.
     *
     * Usage considerations when using shimmed custom properties or `@apply`:
     *
     * * Whenever any dynamic changes are made which affect
     * css custom properties, `ShadyCSS.styleElement(element)` must be called
     * to update the element. There are two cases when this is needed:
     * (1) the element is connected to a new parent, (2) a class is added to the
     * element that causes it to match different custom properties.
     * To address the first case when rendering a custom element, `styleElement`
     * should be called in the element's `connectedCallback`.
     *
     * * Shimmed custom properties may only be defined either for an entire
     * shadowRoot (for example, in a `:host` rule) or via a rule that directly
     * matches an element with a shadowRoot. In other words, instead of flowing from
     * parent to child as do native css custom properties, shimmed custom properties
     * flow only from shadowRoots to nested shadowRoots.
     *
     * * When using `@apply` mixing css shorthand property names with
     * non-shorthand names (for example `border` and `border-width`) is not
     * supported.
     */
    const render = (result, container, options) => {
        if (!options || typeof options !== 'object' || !options.scopeName) {
            throw new Error('The `scopeName` option is required.');
        }
        const scopeName = options.scopeName;
        const hasRendered = parts.has(container);
        const needsScoping = compatibleShadyCSSVersion &&
            container.nodeType === 11 /* Node.DOCUMENT_FRAGMENT_NODE */ &&
            !!container.host;
        // Handle first render to a scope specially...
        const firstScopeRender = needsScoping && !shadyRenderSet.has(scopeName);
        // On first scope render, render into a fragment; this cannot be a single
        // fragment that is reused since nested renders can occur synchronously.
        const renderContainer = firstScopeRender ? document.createDocumentFragment() : container;
        render$1(result, renderContainer, Object.assign({ templateFactory: shadyTemplateFactory(scopeName) }, options));
        // When performing first scope render,
        // (1) We've rendered into a fragment so that there's a chance to
        // `prepareTemplateStyles` before sub-elements hit the DOM
        // (which might cause them to render based on a common pattern of
        // rendering in a custom element's `connectedCallback`);
        // (2) Scope the template with ShadyCSS one time only for this scope.
        // (3) Render the fragment into the container and make sure the
        // container knows its `part` is the one we just rendered. This ensures
        // DOM will be re-used on subsequent renders.
        if (firstScopeRender) {
            const part = parts.get(renderContainer);
            parts.delete(renderContainer);
            // ShadyCSS might have style sheets (e.g. from `prepareAdoptedCssText`)
            // that should apply to `renderContainer` even if the rendered value is
            // not a TemplateInstance. However, it will only insert scoped styles
            // into the document if `prepareTemplateStyles` has already been called
            // for the given scope name.
            const template = part.value instanceof TemplateInstance ?
                part.value.template :
                undefined;
            prepareTemplateStyles(scopeName, renderContainer, template);
            removeNodes(container, container.firstChild);
            container.appendChild(renderContainer);
            parts.set(container, part);
        }
        // After elements have hit the DOM, update styling if this is the
        // initial render to this container.
        // This is needed whenever dynamic changes are made so it would be
        // safest to do every render; however, this would regress performance
        // so we leave it up to the user to call `ShadyCSS.styleElement`
        // for dynamic changes.
        if (!hasRendered && needsScoping) {
            window.ShadyCSS.styleElement(container.host);
        }
    };

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    var _a;
    /**
     * Use this module if you want to create your own base class extending
     * [[UpdatingElement]].
     * @packageDocumentation
     */
    /*
     * When using Closure Compiler, JSCompiler_renameProperty(property, object) is
     * replaced at compile time by the munged name for object[property]. We cannot
     * alias this function, so we have to use a small shim that has the same
     * behavior when not compiling.
     */
    window.JSCompiler_renameProperty =
        (prop, _obj) => prop;
    const defaultConverter = {
        toAttribute(value, type) {
            switch (type) {
                case Boolean:
                    return value ? '' : null;
                case Object:
                case Array:
                    // if the value is `null` or `undefined` pass this through
                    // to allow removing/no change behavior.
                    return value == null ? value : JSON.stringify(value);
            }
            return value;
        },
        fromAttribute(value, type) {
            switch (type) {
                case Boolean:
                    return value !== null;
                case Number:
                    return value === null ? null : Number(value);
                case Object:
                case Array:
                    return JSON.parse(value);
            }
            return value;
        }
    };
    /**
     * Change function that returns true if `value` is different from `oldValue`.
     * This method is used as the default for a property's `hasChanged` function.
     */
    const notEqual = (value, old) => {
        // This ensures (old==NaN, value==NaN) always returns false
        return old !== value && (old === old || value === value);
    };
    const defaultPropertyDeclaration = {
        attribute: true,
        type: String,
        converter: defaultConverter,
        reflect: false,
        hasChanged: notEqual
    };
    const STATE_HAS_UPDATED = 1;
    const STATE_UPDATE_REQUESTED = 1 << 2;
    const STATE_IS_REFLECTING_TO_ATTRIBUTE = 1 << 3;
    const STATE_IS_REFLECTING_TO_PROPERTY = 1 << 4;
    /**
     * The Closure JS Compiler doesn't currently have good support for static
     * property semantics where "this" is dynamic (e.g.
     * https://github.com/google/closure-compiler/issues/3177 and others) so we use
     * this hack to bypass any rewriting by the compiler.
     */
    const finalized = 'finalized';
    /**
     * Base element class which manages element properties and attributes. When
     * properties change, the `update` method is asynchronously called. This method
     * should be supplied by subclassers to render updates as desired.
     * @noInheritDoc
     */
    class UpdatingElement extends HTMLElement {
        constructor() {
            super();
            this.initialize();
        }
        /**
         * Returns a list of attributes corresponding to the registered properties.
         * @nocollapse
         */
        static get observedAttributes() {
            // note: piggy backing on this to ensure we're finalized.
            this.finalize();
            const attributes = [];
            // Use forEach so this works even if for/of loops are compiled to for loops
            // expecting arrays
            this._classProperties.forEach((v, p) => {
                const attr = this._attributeNameForProperty(p, v);
                if (attr !== undefined) {
                    this._attributeToPropertyMap.set(attr, p);
                    attributes.push(attr);
                }
            });
            return attributes;
        }
        /**
         * Ensures the private `_classProperties` property metadata is created.
         * In addition to `finalize` this is also called in `createProperty` to
         * ensure the `@property` decorator can add property metadata.
         */
        /** @nocollapse */
        static _ensureClassProperties() {
            // ensure private storage for property declarations.
            if (!this.hasOwnProperty(JSCompiler_renameProperty('_classProperties', this))) {
                this._classProperties = new Map();
                // NOTE: Workaround IE11 not supporting Map constructor argument.
                const superProperties = Object.getPrototypeOf(this)._classProperties;
                if (superProperties !== undefined) {
                    superProperties.forEach((v, k) => this._classProperties.set(k, v));
                }
            }
        }
        /**
         * Creates a property accessor on the element prototype if one does not exist
         * and stores a PropertyDeclaration for the property with the given options.
         * The property setter calls the property's `hasChanged` property option
         * or uses a strict identity check to determine whether or not to request
         * an update.
         *
         * This method may be overridden to customize properties; however,
         * when doing so, it's important to call `super.createProperty` to ensure
         * the property is setup correctly. This method calls
         * `getPropertyDescriptor` internally to get a descriptor to install.
         * To customize what properties do when they are get or set, override
         * `getPropertyDescriptor`. To customize the options for a property,
         * implement `createProperty` like this:
         *
         * static createProperty(name, options) {
         *   options = Object.assign(options, {myOption: true});
         *   super.createProperty(name, options);
         * }
         *
         * @nocollapse
         */
        static createProperty(name, options = defaultPropertyDeclaration) {
            // Note, since this can be called by the `@property` decorator which
            // is called before `finalize`, we ensure storage exists for property
            // metadata.
            this._ensureClassProperties();
            this._classProperties.set(name, options);
            // Do not generate an accessor if the prototype already has one, since
            // it would be lost otherwise and that would never be the user's intention;
            // Instead, we expect users to call `requestUpdate` themselves from
            // user-defined accessors. Note that if the super has an accessor we will
            // still overwrite it
            if (options.noAccessor || this.prototype.hasOwnProperty(name)) {
                return;
            }
            const key = typeof name === 'symbol' ? Symbol() : `__${name}`;
            const descriptor = this.getPropertyDescriptor(name, key, options);
            if (descriptor !== undefined) {
                Object.defineProperty(this.prototype, name, descriptor);
            }
        }
        /**
         * Returns a property descriptor to be defined on the given named property.
         * If no descriptor is returned, the property will not become an accessor.
         * For example,
         *
         *   class MyElement extends LitElement {
         *     static getPropertyDescriptor(name, key, options) {
         *       const defaultDescriptor =
         *           super.getPropertyDescriptor(name, key, options);
         *       const setter = defaultDescriptor.set;
         *       return {
         *         get: defaultDescriptor.get,
         *         set(value) {
         *           setter.call(this, value);
         *           // custom action.
         *         },
         *         configurable: true,
         *         enumerable: true
         *       }
         *     }
         *   }
         *
         * @nocollapse
         */
        static getPropertyDescriptor(name, key, options) {
            return {
                // tslint:disable-next-line:no-any no symbol in index
                get() {
                    return this[key];
                },
                set(value) {
                    const oldValue = this[name];
                    this[key] = value;
                    this
                        .requestUpdateInternal(name, oldValue, options);
                },
                configurable: true,
                enumerable: true
            };
        }
        /**
         * Returns the property options associated with the given property.
         * These options are defined with a PropertyDeclaration via the `properties`
         * object or the `@property` decorator and are registered in
         * `createProperty(...)`.
         *
         * Note, this method should be considered "final" and not overridden. To
         * customize the options for a given property, override `createProperty`.
         *
         * @nocollapse
         * @final
         */
        static getPropertyOptions(name) {
            return this._classProperties && this._classProperties.get(name) ||
                defaultPropertyDeclaration;
        }
        /**
         * Creates property accessors for registered properties and ensures
         * any superclasses are also finalized.
         * @nocollapse
         */
        static finalize() {
            // finalize any superclasses
            const superCtor = Object.getPrototypeOf(this);
            if (!superCtor.hasOwnProperty(finalized)) {
                superCtor.finalize();
            }
            this[finalized] = true;
            this._ensureClassProperties();
            // initialize Map populated in observedAttributes
            this._attributeToPropertyMap = new Map();
            // make any properties
            // Note, only process "own" properties since this element will inherit
            // any properties defined on the superClass, and finalization ensures
            // the entire prototype chain is finalized.
            if (this.hasOwnProperty(JSCompiler_renameProperty('properties', this))) {
                const props = this.properties;
                // support symbols in properties (IE11 does not support this)
                const propKeys = [
                    ...Object.getOwnPropertyNames(props),
                    ...(typeof Object.getOwnPropertySymbols === 'function') ?
                        Object.getOwnPropertySymbols(props) :
                        []
                ];
                // This for/of is ok because propKeys is an array
                for (const p of propKeys) {
                    // note, use of `any` is due to TypeSript lack of support for symbol in
                    // index types
                    // tslint:disable-next-line:no-any no symbol in index
                    this.createProperty(p, props[p]);
                }
            }
        }
        /**
         * Returns the property name for the given attribute `name`.
         * @nocollapse
         */
        static _attributeNameForProperty(name, options) {
            const attribute = options.attribute;
            return attribute === false ?
                undefined :
                (typeof attribute === 'string' ?
                    attribute :
                    (typeof name === 'string' ? name.toLowerCase() : undefined));
        }
        /**
         * Returns true if a property should request an update.
         * Called when a property value is set and uses the `hasChanged`
         * option for the property if present or a strict identity check.
         * @nocollapse
         */
        static _valueHasChanged(value, old, hasChanged = notEqual) {
            return hasChanged(value, old);
        }
        /**
         * Returns the property value for the given attribute value.
         * Called via the `attributeChangedCallback` and uses the property's
         * `converter` or `converter.fromAttribute` property option.
         * @nocollapse
         */
        static _propertyValueFromAttribute(value, options) {
            const type = options.type;
            const converter = options.converter || defaultConverter;
            const fromAttribute = (typeof converter === 'function' ? converter : converter.fromAttribute);
            return fromAttribute ? fromAttribute(value, type) : value;
        }
        /**
         * Returns the attribute value for the given property value. If this
         * returns undefined, the property will *not* be reflected to an attribute.
         * If this returns null, the attribute will be removed, otherwise the
         * attribute will be set to the value.
         * This uses the property's `reflect` and `type.toAttribute` property options.
         * @nocollapse
         */
        static _propertyValueToAttribute(value, options) {
            if (options.reflect === undefined) {
                return;
            }
            const type = options.type;
            const converter = options.converter;
            const toAttribute = converter && converter.toAttribute ||
                defaultConverter.toAttribute;
            return toAttribute(value, type);
        }
        /**
         * Performs element initialization. By default captures any pre-set values for
         * registered properties.
         */
        initialize() {
            this._updateState = 0;
            this._updatePromise =
                new Promise((res) => this._enableUpdatingResolver = res);
            this._changedProperties = new Map();
            this._saveInstanceProperties();
            // ensures first update will be caught by an early access of
            // `updateComplete`
            this.requestUpdateInternal();
        }
        /**
         * Fixes any properties set on the instance before upgrade time.
         * Otherwise these would shadow the accessor and break these properties.
         * The properties are stored in a Map which is played back after the
         * constructor runs. Note, on very old versions of Safari (<=9) or Chrome
         * (<=41), properties created for native platform properties like (`id` or
         * `name`) may not have default values set in the element constructor. On
         * these browsers native properties appear on instances and therefore their
         * default value will overwrite any element default (e.g. if the element sets
         * this.id = 'id' in the constructor, the 'id' will become '' since this is
         * the native platform default).
         */
        _saveInstanceProperties() {
            // Use forEach so this works even if for/of loops are compiled to for loops
            // expecting arrays
            this.constructor
                ._classProperties.forEach((_v, p) => {
                if (this.hasOwnProperty(p)) {
                    const value = this[p];
                    delete this[p];
                    if (!this._instanceProperties) {
                        this._instanceProperties = new Map();
                    }
                    this._instanceProperties.set(p, value);
                }
            });
        }
        /**
         * Applies previously saved instance properties.
         */
        _applyInstanceProperties() {
            // Use forEach so this works even if for/of loops are compiled to for loops
            // expecting arrays
            // tslint:disable-next-line:no-any
            this._instanceProperties.forEach((v, p) => this[p] = v);
            this._instanceProperties = undefined;
        }
        connectedCallback() {
            // Ensure first connection completes an update. Updates cannot complete
            // before connection.
            this.enableUpdating();
        }
        enableUpdating() {
            if (this._enableUpdatingResolver !== undefined) {
                this._enableUpdatingResolver();
                this._enableUpdatingResolver = undefined;
            }
        }
        /**
         * Allows for `super.disconnectedCallback()` in extensions while
         * reserving the possibility of making non-breaking feature additions
         * when disconnecting at some point in the future.
         */
        disconnectedCallback() {
        }
        /**
         * Synchronizes property values when attributes change.
         */
        attributeChangedCallback(name, old, value) {
            if (old !== value) {
                this._attributeToProperty(name, value);
            }
        }
        _propertyToAttribute(name, value, options = defaultPropertyDeclaration) {
            const ctor = this.constructor;
            const attr = ctor._attributeNameForProperty(name, options);
            if (attr !== undefined) {
                const attrValue = ctor._propertyValueToAttribute(value, options);
                // an undefined value does not change the attribute.
                if (attrValue === undefined) {
                    return;
                }
                // Track if the property is being reflected to avoid
                // setting the property again via `attributeChangedCallback`. Note:
                // 1. this takes advantage of the fact that the callback is synchronous.
                // 2. will behave incorrectly if multiple attributes are in the reaction
                // stack at time of calling. However, since we process attributes
                // in `update` this should not be possible (or an extreme corner case
                // that we'd like to discover).
                // mark state reflecting
                this._updateState = this._updateState | STATE_IS_REFLECTING_TO_ATTRIBUTE;
                if (attrValue == null) {
                    this.removeAttribute(attr);
                }
                else {
                    this.setAttribute(attr, attrValue);
                }
                // mark state not reflecting
                this._updateState = this._updateState & ~STATE_IS_REFLECTING_TO_ATTRIBUTE;
            }
        }
        _attributeToProperty(name, value) {
            // Use tracking info to avoid deserializing attribute value if it was
            // just set from a property setter.
            if (this._updateState & STATE_IS_REFLECTING_TO_ATTRIBUTE) {
                return;
            }
            const ctor = this.constructor;
            // Note, hint this as an `AttributeMap` so closure clearly understands
            // the type; it has issues with tracking types through statics
            // tslint:disable-next-line:no-unnecessary-type-assertion
            const propName = ctor._attributeToPropertyMap.get(name);
            if (propName !== undefined) {
                const options = ctor.getPropertyOptions(propName);
                // mark state reflecting
                this._updateState = this._updateState | STATE_IS_REFLECTING_TO_PROPERTY;
                this[propName] =
                    // tslint:disable-next-line:no-any
                    ctor._propertyValueFromAttribute(value, options);
                // mark state not reflecting
                this._updateState = this._updateState & ~STATE_IS_REFLECTING_TO_PROPERTY;
            }
        }
        /**
         * This protected version of `requestUpdate` does not access or return the
         * `updateComplete` promise. This promise can be overridden and is therefore
         * not free to access.
         */
        requestUpdateInternal(name, oldValue, options) {
            let shouldRequestUpdate = true;
            // If we have a property key, perform property update steps.
            if (name !== undefined) {
                const ctor = this.constructor;
                options = options || ctor.getPropertyOptions(name);
                if (ctor._valueHasChanged(this[name], oldValue, options.hasChanged)) {
                    if (!this._changedProperties.has(name)) {
                        this._changedProperties.set(name, oldValue);
                    }
                    // Add to reflecting properties set.
                    // Note, it's important that every change has a chance to add the
                    // property to `_reflectingProperties`. This ensures setting
                    // attribute + property reflects correctly.
                    if (options.reflect === true &&
                        !(this._updateState & STATE_IS_REFLECTING_TO_PROPERTY)) {
                        if (this._reflectingProperties === undefined) {
                            this._reflectingProperties = new Map();
                        }
                        this._reflectingProperties.set(name, options);
                    }
                }
                else {
                    // Abort the request if the property should not be considered changed.
                    shouldRequestUpdate = false;
                }
            }
            if (!this._hasRequestedUpdate && shouldRequestUpdate) {
                this._updatePromise = this._enqueueUpdate();
            }
        }
        /**
         * Requests an update which is processed asynchronously. This should
         * be called when an element should update based on some state not triggered
         * by setting a property. In this case, pass no arguments. It should also be
         * called when manually implementing a property setter. In this case, pass the
         * property `name` and `oldValue` to ensure that any configured property
         * options are honored. Returns the `updateComplete` Promise which is resolved
         * when the update completes.
         *
         * @param name {PropertyKey} (optional) name of requesting property
         * @param oldValue {any} (optional) old value of requesting property
         * @returns {Promise} A Promise that is resolved when the update completes.
         */
        requestUpdate(name, oldValue) {
            this.requestUpdateInternal(name, oldValue);
            return this.updateComplete;
        }
        /**
         * Sets up the element to asynchronously update.
         */
        async _enqueueUpdate() {
            this._updateState = this._updateState | STATE_UPDATE_REQUESTED;
            try {
                // Ensure any previous update has resolved before updating.
                // This `await` also ensures that property changes are batched.
                await this._updatePromise;
            }
            catch (e) {
                // Ignore any previous errors. We only care that the previous cycle is
                // done. Any error should have been handled in the previous update.
            }
            const result = this.performUpdate();
            // If `performUpdate` returns a Promise, we await it. This is done to
            // enable coordinating updates with a scheduler. Note, the result is
            // checked to avoid delaying an additional microtask unless we need to.
            if (result != null) {
                await result;
            }
            return !this._hasRequestedUpdate;
        }
        get _hasRequestedUpdate() {
            return (this._updateState & STATE_UPDATE_REQUESTED);
        }
        get hasUpdated() {
            return (this._updateState & STATE_HAS_UPDATED);
        }
        /**
         * Performs an element update. Note, if an exception is thrown during the
         * update, `firstUpdated` and `updated` will not be called.
         *
         * You can override this method to change the timing of updates. If this
         * method is overridden, `super.performUpdate()` must be called.
         *
         * For instance, to schedule updates to occur just before the next frame:
         *
         * ```
         * protected async performUpdate(): Promise<unknown> {
         *   await new Promise((resolve) => requestAnimationFrame(() => resolve()));
         *   super.performUpdate();
         * }
         * ```
         */
        performUpdate() {
            // Abort any update if one is not pending when this is called.
            // This can happen if `performUpdate` is called early to "flush"
            // the update.
            if (!this._hasRequestedUpdate) {
                return;
            }
            // Mixin instance properties once, if they exist.
            if (this._instanceProperties) {
                this._applyInstanceProperties();
            }
            let shouldUpdate = false;
            const changedProperties = this._changedProperties;
            try {
                shouldUpdate = this.shouldUpdate(changedProperties);
                if (shouldUpdate) {
                    this.update(changedProperties);
                }
                else {
                    this._markUpdated();
                }
            }
            catch (e) {
                // Prevent `firstUpdated` and `updated` from running when there's an
                // update exception.
                shouldUpdate = false;
                // Ensure element can accept additional updates after an exception.
                this._markUpdated();
                throw e;
            }
            if (shouldUpdate) {
                if (!(this._updateState & STATE_HAS_UPDATED)) {
                    this._updateState = this._updateState | STATE_HAS_UPDATED;
                    this.firstUpdated(changedProperties);
                }
                this.updated(changedProperties);
            }
        }
        _markUpdated() {
            this._changedProperties = new Map();
            this._updateState = this._updateState & ~STATE_UPDATE_REQUESTED;
        }
        /**
         * Returns a Promise that resolves when the element has completed updating.
         * The Promise value is a boolean that is `true` if the element completed the
         * update without triggering another update. The Promise result is `false` if
         * a property was set inside `updated()`. If the Promise is rejected, an
         * exception was thrown during the update.
         *
         * To await additional asynchronous work, override the `_getUpdateComplete`
         * method. For example, it is sometimes useful to await a rendered element
         * before fulfilling this Promise. To do this, first await
         * `super._getUpdateComplete()`, then any subsequent state.
         *
         * @returns {Promise} The Promise returns a boolean that indicates if the
         * update resolved without triggering another update.
         */
        get updateComplete() {
            return this._getUpdateComplete();
        }
        /**
         * Override point for the `updateComplete` promise.
         *
         * It is not safe to override the `updateComplete` getter directly due to a
         * limitation in TypeScript which means it is not possible to call a
         * superclass getter (e.g. `super.updateComplete.then(...)`) when the target
         * language is ES5 (https://github.com/microsoft/TypeScript/issues/338).
         * This method should be overridden instead. For example:
         *
         *   class MyElement extends LitElement {
         *     async _getUpdateComplete() {
         *       await super._getUpdateComplete();
         *       await this._myChild.updateComplete;
         *     }
         *   }
         */
        _getUpdateComplete() {
            return this._updatePromise;
        }
        /**
         * Controls whether or not `update` should be called when the element requests
         * an update. By default, this method always returns `true`, but this can be
         * customized to control when to update.
         *
         * @param _changedProperties Map of changed properties with old values
         */
        shouldUpdate(_changedProperties) {
            return true;
        }
        /**
         * Updates the element. This method reflects property values to attributes.
         * It can be overridden to render and keep updated element DOM.
         * Setting properties inside this method will *not* trigger
         * another update.
         *
         * @param _changedProperties Map of changed properties with old values
         */
        update(_changedProperties) {
            if (this._reflectingProperties !== undefined &&
                this._reflectingProperties.size > 0) {
                // Use forEach so this works even if for/of loops are compiled to for
                // loops expecting arrays
                this._reflectingProperties.forEach((v, k) => this._propertyToAttribute(k, this[k], v));
                this._reflectingProperties = undefined;
            }
            this._markUpdated();
        }
        /**
         * Invoked whenever the element is updated. Implement to perform
         * post-updating tasks via DOM APIs, for example, focusing an element.
         *
         * Setting properties inside this method will trigger the element to update
         * again after this update cycle completes.
         *
         * @param _changedProperties Map of changed properties with old values
         */
        updated(_changedProperties) {
        }
        /**
         * Invoked when the element is first updated. Implement to perform one time
         * work on the element after update.
         *
         * Setting properties inside this method will trigger the element to update
         * again after this update cycle completes.
         *
         * @param _changedProperties Map of changed properties with old values
         */
        firstUpdated(_changedProperties) {
        }
    }
    _a = finalized;
    /**
     * Marks class as having finished creating properties.
     */
    UpdatingElement[_a] = true;

    /**
    @license
    Copyright (c) 2019 The Polymer Project Authors. All rights reserved.
    This code may only be used under the BSD style license found at
    http://polymer.github.io/LICENSE.txt The complete set of authors may be found at
    http://polymer.github.io/AUTHORS.txt The complete set of contributors may be
    found at http://polymer.github.io/CONTRIBUTORS.txt Code distributed by Google as
    part of the polymer project is also subject to an additional IP rights grant
    found at http://polymer.github.io/PATENTS.txt
    */
    /**
     * Whether the current browser supports `adoptedStyleSheets`.
     */
    const supportsAdoptingStyleSheets = (window.ShadowRoot) &&
        (window.ShadyCSS === undefined || window.ShadyCSS.nativeShadow) &&
        ('adoptedStyleSheets' in Document.prototype) &&
        ('replace' in CSSStyleSheet.prototype);
    const constructionToken = Symbol();
    class CSSResult {
        constructor(cssText, safeToken) {
            if (safeToken !== constructionToken) {
                throw new Error('CSSResult is not constructable. Use `unsafeCSS` or `css` instead.');
            }
            this.cssText = cssText;
        }
        // Note, this is a getter so that it's lazy. In practice, this means
        // stylesheets are not created until the first element instance is made.
        get styleSheet() {
            if (this._styleSheet === undefined) {
                // Note, if `supportsAdoptingStyleSheets` is true then we assume
                // CSSStyleSheet is constructable.
                if (supportsAdoptingStyleSheets) {
                    this._styleSheet = new CSSStyleSheet();
                    this._styleSheet.replaceSync(this.cssText);
                }
                else {
                    this._styleSheet = null;
                }
            }
            return this._styleSheet;
        }
        toString() {
            return this.cssText;
        }
    }
    /**
     * Wrap a value for interpolation in a [[`css`]] tagged template literal.
     *
     * This is unsafe because untrusted CSS text can be used to phone home
     * or exfiltrate data to an attacker controlled site. Take care to only use
     * this with trusted input.
     */
    const unsafeCSS = (value) => {
        return new CSSResult(String(value), constructionToken);
    };

    /**
     * @license
     * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
     * This code may only be used under the BSD style license found at
     * http://polymer.github.io/LICENSE.txt
     * The complete set of authors may be found at
     * http://polymer.github.io/AUTHORS.txt
     * The complete set of contributors may be found at
     * http://polymer.github.io/CONTRIBUTORS.txt
     * Code distributed by Google as part of the polymer project is also
     * subject to an additional IP rights grant found at
     * http://polymer.github.io/PATENTS.txt
     */
    // IMPORTANT: do not change the property name or the assignment expression.
    // This line will be used in regexes to search for LitElement usage.
    // TODO(justinfagnani): inject version number at build time
    (window['litElementVersions'] || (window['litElementVersions'] = []))
        .push('2.4.0');
    /**
     * Sentinal value used to avoid calling lit-html's render function when
     * subclasses do not implement `render`
     */
    const renderNotImplemented = {};
    /**
     * Base element class that manages element properties and attributes, and
     * renders a lit-html template.
     *
     * To define a component, subclass `LitElement` and implement a
     * `render` method to provide the component's template. Define properties
     * using the [[`properties`]] property or the [[`property`]] decorator.
     */
    class LitElement extends UpdatingElement {
        /**
         * Return the array of styles to apply to the element.
         * Override this method to integrate into a style management system.
         *
         * @nocollapse
         */
        static getStyles() {
            return this.styles;
        }
        /** @nocollapse */
        static _getUniqueStyles() {
            // Only gather styles once per class
            if (this.hasOwnProperty(JSCompiler_renameProperty('_styles', this))) {
                return;
            }
            // Take care not to call `this.getStyles()` multiple times since this
            // generates new CSSResults each time.
            // TODO(sorvell): Since we do not cache CSSResults by input, any
            // shared styles will generate new stylesheet objects, which is wasteful.
            // This should be addressed when a browser ships constructable
            // stylesheets.
            const userStyles = this.getStyles();
            if (Array.isArray(userStyles)) {
                // De-duplicate styles preserving the _last_ instance in the set.
                // This is a performance optimization to avoid duplicated styles that can
                // occur especially when composing via subclassing.
                // The last item is kept to try to preserve the cascade order with the
                // assumption that it's most important that last added styles override
                // previous styles.
                const addStyles = (styles, set) => styles.reduceRight((set, s) => 
                // Note: On IE set.add() does not return the set
                Array.isArray(s) ? addStyles(s, set) : (set.add(s), set), set);
                // Array.from does not work on Set in IE, otherwise return
                // Array.from(addStyles(userStyles, new Set<CSSResult>())).reverse()
                const set = addStyles(userStyles, new Set());
                const styles = [];
                set.forEach((v) => styles.unshift(v));
                this._styles = styles;
            }
            else {
                this._styles = userStyles === undefined ? [] : [userStyles];
            }
            // Ensure that there are no invalid CSSStyleSheet instances here. They are
            // invalid in two conditions.
            // (1) the sheet is non-constructible (`sheet` of a HTMLStyleElement), but
            //     this is impossible to check except via .replaceSync or use
            // (2) the ShadyCSS polyfill is enabled (:. supportsAdoptingStyleSheets is
            //     false)
            this._styles = this._styles.map((s) => {
                if (s instanceof CSSStyleSheet && !supportsAdoptingStyleSheets) {
                    // Flatten the cssText from the passed constructible stylesheet (or
                    // undetectable non-constructible stylesheet). The user might have
                    // expected to update their stylesheets over time, but the alternative
                    // is a crash.
                    const cssText = Array.prototype.slice.call(s.cssRules)
                        .reduce((css, rule) => css + rule.cssText, '');
                    return unsafeCSS(cssText);
                }
                return s;
            });
        }
        /**
         * Performs element initialization. By default this calls
         * [[`createRenderRoot`]] to create the element [[`renderRoot`]] node and
         * captures any pre-set values for registered properties.
         */
        initialize() {
            super.initialize();
            this.constructor._getUniqueStyles();
            this.renderRoot = this.createRenderRoot();
            // Note, if renderRoot is not a shadowRoot, styles would/could apply to the
            // element's getRootNode(). While this could be done, we're choosing not to
            // support this now since it would require different logic around de-duping.
            if (window.ShadowRoot && this.renderRoot instanceof window.ShadowRoot) {
                this.adoptStyles();
            }
        }
        /**
         * Returns the node into which the element should render and by default
         * creates and returns an open shadowRoot. Implement to customize where the
         * element's DOM is rendered. For example, to render into the element's
         * childNodes, return `this`.
         * @returns {Element|DocumentFragment} Returns a node into which to render.
         */
        createRenderRoot() {
            return this.attachShadow({ mode: 'open' });
        }
        /**
         * Applies styling to the element shadowRoot using the [[`styles`]]
         * property. Styling will apply using `shadowRoot.adoptedStyleSheets` where
         * available and will fallback otherwise. When Shadow DOM is polyfilled,
         * ShadyCSS scopes styles and adds them to the document. When Shadow DOM
         * is available but `adoptedStyleSheets` is not, styles are appended to the
         * end of the `shadowRoot` to [mimic spec
         * behavior](https://wicg.github.io/construct-stylesheets/#using-constructed-stylesheets).
         */
        adoptStyles() {
            const styles = this.constructor._styles;
            if (styles.length === 0) {
                return;
            }
            // There are three separate cases here based on Shadow DOM support.
            // (1) shadowRoot polyfilled: use ShadyCSS
            // (2) shadowRoot.adoptedStyleSheets available: use it
            // (3) shadowRoot.adoptedStyleSheets polyfilled: append styles after
            // rendering
            if (window.ShadyCSS !== undefined && !window.ShadyCSS.nativeShadow) {
                window.ShadyCSS.ScopingShim.prepareAdoptedCssText(styles.map((s) => s.cssText), this.localName);
            }
            else if (supportsAdoptingStyleSheets) {
                this.renderRoot.adoptedStyleSheets =
                    styles.map((s) => s instanceof CSSStyleSheet ? s : s.styleSheet);
            }
            else {
                // This must be done after rendering so the actual style insertion is done
                // in `update`.
                this._needsShimAdoptedStyleSheets = true;
            }
        }
        connectedCallback() {
            super.connectedCallback();
            // Note, first update/render handles styleElement so we only call this if
            // connected after first update.
            if (this.hasUpdated && window.ShadyCSS !== undefined) {
                window.ShadyCSS.styleElement(this);
            }
        }
        /**
         * Updates the element. This method reflects property values to attributes
         * and calls `render` to render DOM via lit-html. Setting properties inside
         * this method will *not* trigger another update.
         * @param _changedProperties Map of changed properties with old values
         */
        update(changedProperties) {
            // Setting properties in `render` should not trigger an update. Since
            // updates are allowed after super.update, it's important to call `render`
            // before that.
            const templateResult = this.render();
            super.update(changedProperties);
            // If render is not implemented by the component, don't call lit-html render
            if (templateResult !== renderNotImplemented) {
                this.constructor
                    .render(templateResult, this.renderRoot, { scopeName: this.localName, eventContext: this });
            }
            // When native Shadow DOM is used but adoptedStyles are not supported,
            // insert styling after rendering to ensure adoptedStyles have highest
            // priority.
            if (this._needsShimAdoptedStyleSheets) {
                this._needsShimAdoptedStyleSheets = false;
                this.constructor._styles.forEach((s) => {
                    const style = document.createElement('style');
                    style.textContent = s.cssText;
                    this.renderRoot.appendChild(style);
                });
            }
        }
        /**
         * Invoked on each update to perform rendering tasks. This method may return
         * any value renderable by lit-html's `NodePart` - typically a
         * `TemplateResult`. Setting properties inside this method will *not* trigger
         * the element to update.
         */
        render() {
            return renderNotImplemented;
        }
    }
    /**
     * Ensure this class is marked as `finalized` as an optimization ensuring
     * it will not needlessly try to `finalize`.
     *
     * Note this property name is a string to prevent breaking Closure JS Compiler
     * optimizations. See updating-element.ts for more information.
     */
    LitElement['finalized'] = true;
    /**
     * Reference to the underlying library method used to render the element's
     * DOM. By default, points to the `render` method from lit-html's shady-render
     * module.
     *
     * **Most users will never need to touch this property.**
     *
     * This  property should not be confused with the `render` instance method,
     * which should be overridden to define a template for the element.
     *
     * Advanced users creating a new base class based on LitElement can override
     * this property to point to a custom render method with a signature that
     * matches [shady-render's `render`
     * method](https://lit-html.polymer-project.org/api/modules/shady_render.html#render).
     *
     * @nocollapse
     */
    LitElement.render = render;

    let preload = false;

    const DEFAULT_MAC = [0x00, 0x22, 0x15, 0x10, 0x11, 0x12];


    // ===========================================================================
    class OWTV86Browser extends LitElement
    {
      constructor() {
        super();
        this.lib86Url = "dist/libv86.js";

        this.emulator = null;
      }

      createRenderRoot() {
        return this;
      }

      static get properties() {
        return {
          url: { type: String },
          ts: { type: String },
          opts: { type: Object }
        }
      }

      firstUpdated() {
        if (!window.V86Starter) {
          const script = document.createElement("script");
          script.src = this.lib86Url;
          script.onload = () => this.initEmu();
          document.head.appendChild(script);
        } else {
          this.initEmu();
        }
      }

      async initEmu() {
        const emuDiv = this.renderRoot.querySelector("#emu");
        let hda = null;

        preload = !this.opts.stateUrl;

        if (preload) {
          const resp = await fetch(this.opts.imageUrl);
          hda = {buffer: await resp.arrayBuffer()};
        } else {
          hda = {
            url: this.opts.imageUrl,
            async: true,
            size: this.opts.imageSize
          };
        }

        const initOpts =  {
          screen_container: emuDiv,
          memory_size: 512 * 1024 * 1024,
          vga_memory_size: 16 * 1024 * 1024,
          bios: {
              url:  this.opts.biosPath + "seabios.bin",
          },
          vga_bios: {
              url: this.opts.biosPath + "vgabios.bin",
          },
          hda,
          preserve_mac_from_state_image: true,
          acpi: !!this.opts.acpi,
          autostart: true,
          wasm_path: "dist/v86.wasm",
          network_adapter: (bus) => new V86Network(bus, this.url, this.ts, this.opts.clientIP, this.opts.clientMAC),
          mac_address: DEFAULT_MAC,
        };

        let stateLoad = false;

        if (this.opts.stateUrl) {
          try {
            const initial_state = await this.loadIncremental(this.opts.stateUrl);
            stateLoad = true;

            initOpts.initial_state = initial_state;

            //setTimeout(() => window.emulator.restore_state(initial_state), 100);
          } catch (e) {
            console.warn("Couldn't load state", e);
          }
        }

        this.emulator = new V86Starter(initOpts);
        window.emulator = this.emulator;

        if (!stateLoad) {
          setTimeout(() => {
            console.log("Cancel scandisk keycode sent");
            this.emulator.keyboard_send_scancodes([0x2D]);
          }, 3000);
        }
      }

      async loadIncremental(url) {
        const resp = await fetch(this.opts.stateUrl);
        if (resp.status !== 200) {
          throw new Error("Invalid state response");
        }
        const total = Number(resp.headers.get("x-amz-meta-full-content-length"));

        const reader = resp.body.getReader();

        const chunks = [];
        let count = 0;

        while(true) {
          const {done, value} = await reader.read();

          if (done) {
            break;
          }

          chunks.push(value);
          count += value.length;

          console.log(`${count} of ${total}`);
          const detail = {count, total};
          this.dispatchEvent(new CustomEvent("dl-progress", {detail}));
        }

        this.dispatchEvent(new CustomEvent("dl-progress", {}));

        const buffer = new Uint8Array(count);

        count = 0;

        for (const chunk of chunks) {
          buffer.set(chunk, count);
          count += chunk.length;
        }

        return buffer;
      }

      render() {
        return html`
      <div id="emu">
        <div id="screen"></div>
        <canvas @click="${this.captureMouse}" id="vga"></canvas>
      </div>
    `;
      }

      captureMouse() {
        this.emulator.lock_mouse();
      }
    }


    // ===========================================================================
    class V86Network
    {
      constructor(bus, replayUrl, replayTs, clientIP, clientMAC) {
        console.log("URL", replayUrl);
        console.log("TS", replayTs);

        const recvCallback = null ;
        
        this.jsnet = new JSNetClient({
          jsnetUrl: "dist/jsnet.js",
          replayTs, replayUrl, clientIP, clientMAC,
          recvCallback,
        });
        this.bus = bus;

        this.bus.register("net0-send", (data) => this.jsnet.send(data), this);

        {
          this.loop = setInterval(() => this.recvLoop(), 10);
        }
      }

      recv(data) {
        this.bus.send("net0-receive", data);
      }

      recvLoop() {
        this.jsnet.pollRecv((data) => this.recv(data));
      }

      destroy() {
        clearInterval(this.loop);
      }
    }

    function bas_main(config = {}, progressTarget) {

      var SCREEN_WIDTH = parseInt(config.width) || 800;
      var SCREEN_HEIGHT = parseInt(config.height) || 600;

      var canvas = document.querySelector(config.canvas);

      canvas.width = SCREEN_WIDTH;
      canvas.height = SCREEN_HEIGHT;

      var audio = {
        channels: 1,
        bytesPerSample: 2,
        samples: 4096,
        // freq: 11025,
        freq: 22050,
        // freq: 44100,
        format: 0x8010,
        paused: false,
        timer: null,
        silence: 0,
        maxBuffersInSharedMemory: 5,
        nextPlayTime: 0,
      };

      var audioTotalSamples = audio.samples * audio.channels;
      audio.bytesPerSample =
        audio.format == 0x0008 /*AUDIO_U8*/ || audio.format == 0x8008 /*AUDIO_S8*/
          ? 1
          : 2;
      audio.bufferSize = audioTotalSamples * audio.bytesPerSample;
      audio.bufferDurationSecs =
        audio.bufferSize / audio.bytesPerSample / audio.channels / audio.freq; // Duration of a single queued buffer in seconds.
      audio.bufferingDelay = 50 / 1000; // Audio samples are played with a constant delay of this many seconds to account for browser and jitter.

      // To account for jittering in frametimes, always have multiple audio buffers queued up for the audio output device.
      // This helps that we won't starve that easily if a frame takes long to complete.
      audio.numSimultaneouslyQueuedBuffers = 5;
      audio.nextChunkIndex = 0;

      var SCREEN_BUFFER_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT * 4; // 32bpp;

      var canvasCtx = canvas.getContext('2d');
      var imageData = canvasCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

      var screenBuffer = new SharedArrayBuffer(SCREEN_BUFFER_SIZE);
      var screenBufferView = new Uint8Array(screenBuffer);

      var VIDEO_MODE_BUFFER_SIZE = 10;
      var videoModeBuffer = new SharedArrayBuffer(VIDEO_MODE_BUFFER_SIZE * 4);
      var videoModeBufferView = new Int32Array(videoModeBuffer);

      var AUDIO_CONFIG_BUFFER_SIZE = 10;
      new SharedArrayBuffer(AUDIO_CONFIG_BUFFER_SIZE);

      var audioBlockChunkSize = audio.bufferSize + 2;
      var AUDIO_DATA_BUFFER_SIZE =
        audioBlockChunkSize * audio.maxBuffersInSharedMemory;
      var audioDataBuffer = new SharedArrayBuffer(AUDIO_DATA_BUFFER_SIZE);
      var audioDataBufferView = new Uint8Array(audioDataBuffer);

      var INPUT_BUFFER_SIZE = 100;
      var inputBuffer = new SharedArrayBuffer(INPUT_BUFFER_SIZE * 4);
      var inputBufferView = new Int32Array(inputBuffer);
      var inputQueue = [];

      var Atomics_notify = Atomics.wake || Atomics.notify;

      var InputBufferAddresses = {
        globalLockAddr: 0,
        mouseMoveFlagAddr: 1,
        mouseMoveXDeltaAddr: 2,
        mouseMoveYDeltaAddr: 3,
        mouseButtonStateAddr: 4,
        keyEventFlagAddr: 5,
        keyCodeAddr: 6,
        keyStateAddr: 7,
      };

      var LockStates = {
        READY_FOR_UI_THREAD: 0,
        UI_THREAD_LOCK: 1,
        READY_FOR_EMUL_THREAD: 2,
        EMUL_THREAD_LOCK: 3,
      };

      var audioContext = new AudioContext();

      var gainNode = audioContext.createGain();

      gainNode.gain.value = 1;
      gainNode.connect(audioContext.destination);

      function openAudio() {
        audio.pushAudio = function pushAudio(
          blockBuffer, // u8 typed array
          sizeBytes // probably (frames per block=4096) * (bytes per sample=2) * (n channels=1)
        ) {
          if (audio.paused) return;

          var sizeSamples = sizeBytes / audio.bytesPerSample; // How many samples fit in the callback buffer?
          var sizeSamplesPerChannel = sizeSamples / audio.channels; // How many samples per a single channel fit in the cb buffer?
          if (sizeSamplesPerChannel != audio.samples) {
            throw 'Received mismatching audio buffer size!';
          }
          // Allocate new sound buffer to be played.
          var source = audioContext.createBufferSource();
          var soundBuffer = audioContext.createBuffer(
            audio.channels,
            sizeSamplesPerChannel,
            audio.freq
          );
          // source.connect(audioContext.destination);
          source.connect(gainNode);

          audio.fillWebAudioBufferFromChunk(
            blockBuffer,
            sizeSamplesPerChannel,
            soundBuffer
          );
          // Workaround https://bugzilla.mozilla.org/show_bug.cgi?id=883675 by setting the buffer only after filling. The order is important here!
          source.buffer = soundBuffer;

          // Schedule the generated sample buffer to be played out at the correct time right after the previously scheduled
          // sample buffer has finished.
          var curtime = audioContext.currentTime;

          // assertion
          if (curtime > audio.nextPlayTime && audio.nextPlayTime != 0) ;

          // Don't ever start buffer playbacks earlier from current time than a given constant 'audio.bufferingDelay', since a browser
          // may not be able to mix that audio clip in immediately, and there may be subsequent jitter that might cause the stream to starve.
          var playtime = Math.max(curtime + audio.bufferingDelay, audio.nextPlayTime);
          source.start(playtime);
          // console.log(`queuing audio for ${playtime}`)

          audio.nextPlayTime = playtime + audio.bufferDurationSecs;
        };

        audio.getBlockBuffer = function getBlockBuffer() {
          // audio chunk layout
          // 0: lock state
          // 1: pointer to next chunk
          // 2 to (2+buffersize): audio buffer
          var curChunkIndex = audio.nextChunkIndex;
          var curChunkAddr = curChunkIndex * audioBlockChunkSize;

          if (audioDataBufferView[curChunkAddr] !== LockStates.UI_THREAD_LOCK) {
            if (audio.gotFirstBlock) ;
            return null;
          }
          audio.gotFirstBlock = true;

          var blockBuffer = audioDataBufferView.slice(
            curChunkAddr + 2,
            curChunkAddr + 2 + audio.bufferSize
          );
          audio.nextChunkIndex = audioDataBufferView[curChunkAddr + 1];
          // console.assert(audio.nextChunkIndex != curChunkIndex, `curChunkIndex=${curChunkIndex} == nextChunkIndex=${audio.nextChunkIndex}`)
          audioDataBufferView[curChunkAddr] = LockStates.EMUL_THREAD_LOCK;
          return blockBuffer;
        };

        audio.fillWebAudioBufferFromChunk = function fillWebAudioBufferFromChunk(
          blockBuffer, // u8 typed array
          blockSize, // probably 4096
          dstAudioBuffer
        ) {
          for (var c = 0; c < audio.channels; ++c) {
            var channelData = dstAudioBuffer.getChannelData(c);
            if (channelData.length != blockSize) {
              throw 'Web Audio output buffer length mismatch! Destination size: ' +
                channelData.length +
                ' samples vs expected ' +
                blockSize +
                ' samples!';
            }
            var blockBufferI16 = new Int16Array(blockBuffer.buffer);

            for (var j = 0; j < blockSize; ++j) {
              channelData[j] = blockBufferI16[j] / 0x8000; // convert i16 to f32 in range -1 to +1
            }
          }
        };

        // Pulls and queues new audio data if appropriate. This function gets "over-called" in both requestAnimationFrames and
        // setTimeouts to ensure that we get the finest granularity possible and as many chances from the browser to fill
        // new audio data. This is because setTimeouts alone have very poor granularity for audio streaming purposes, but also
        // the application might not be using emscripten_set_main_loop to drive the main loop, so we cannot rely on that alone.
        audio.queueNewAudioData = function queueNewAudioData() {
          var i = 0;
          for (; i < audio.numSimultaneouslyQueuedBuffers; ++i) {
            // Only queue new data if we don't have enough audio data already in queue. Otherwise skip this time slot
            // and wait to queue more in the next time the callback is run.
            var secsUntilNextPlayStart =
              audio.nextPlayTime - audioContext.currentTime;
            if (
              secsUntilNextPlayStart >=
              audio.bufferingDelay +
                audio.bufferDurationSecs * audio.numSimultaneouslyQueuedBuffers
            )
              return;

            var blockBuffer = audio.getBlockBuffer();
            if (!blockBuffer) {
              return;
            }

            // And queue it to be played after the currently playing audio stream.
            audio.pushAudio(blockBuffer, audio.bufferSize);
          }
          // console.log(`queued ${i} buffers of audio`);
        };

        // Create a callback function that will be routinely called to ask more audio data from the user application.
        audio.caller = function audioCaller() {
          --audio.numAudioTimersPending;

          audio.queueNewAudioData();

          // Queue this callback function to be called again later to pull more audio data.
          var secsUntilNextPlayStart = audio.nextPlayTime - audioContext.currentTime;

          // Queue the next audio frame push to be performed half-way when the previously queued buffer has finished playing.
          var preemptBufferFeedSecs = audio.bufferDurationSecs / 2.0;

          if (audio.numAudioTimersPending < audio.numSimultaneouslyQueuedBuffers) {
            ++audio.numAudioTimersPending;
            audio.timer = setTimeout(
              audio.caller,
              Math.max(0.0, 1000.0 * (secsUntilNextPlayStart - preemptBufferFeedSecs))
            );

            // If we are risking starving, immediately queue an extra buffer.
            if (audio.numAudioTimersPending < audio.numSimultaneouslyQueuedBuffers) {
              ++audio.numAudioTimersPending;
              setTimeout(audio.caller, 1.0);
            }
          }
        };

        audio.numAudioTimersPending = 1;
        audio.timer = setTimeout(audio.caller, 1);
      }

      function releaseTwoStateLock(bufferView, lockIndex) {
        Atomics.store(bufferView, lockIndex, LockStates.EMUL_THREAD_LOCK); // unlock

        Atomics_notify(bufferView, lockIndex);
      }

      releaseTwoStateLock(videoModeBufferView, 9);

      function acquireLock(bufferView, lockIndex) {
        var res = Atomics.compareExchange(
          bufferView,
          lockIndex,
          LockStates.READY_FOR_UI_THREAD,
          LockStates.UI_THREAD_LOCK
        );
        if (res === LockStates.READY_FOR_UI_THREAD) {
          return true;
        }
        return false;
      }

      function releaseLock(bufferView, lockIndex) {
        Atomics.store(bufferView, lockIndex, LockStates.READY_FOR_EMUL_THREAD); // unlock

        Atomics_notify(bufferView, lockIndex);
      }

      function releaseInputLock() {
        releaseLock(inputBufferView, InputBufferAddresses.globalLockAddr);
      }
      function tryToSendInput() {
        if (!acquireLock(inputBufferView, InputBufferAddresses.globalLockAddr)) {
          return;
        }
        var hasMouseMove = false;
        var mouseMoveX = 0;
        var mouseMoveY = 0;
        var mouseButtonState = -1;
        var hasKeyEvent = false;
        var keyCode = -1;
        var keyState = -1;
        // currently only one key event can be sent per sync
        // TODO: better key handling code
        var remainingKeyEvents = [];
        for (var i = 0; i < inputQueue.length; i++) {
          var inputEvent = inputQueue[i];
          switch (inputEvent.type) {
            case 'mousemove':
              if (hasMouseMove) {
                break;
              }
              hasMouseMove = true;
              mouseMoveX += inputEvent.dx;
              mouseMoveY += inputEvent.dy;
              break;
            case 'mousedown':
            case 'mouseup':
              mouseButtonState = inputEvent.type === 'mousedown' ? 1 : 0;
              break;
            case 'keydown':
            case 'keyup':
              if (hasKeyEvent) {
                remainingKeyEvents.push(inputEvent);
                break;
              }
              hasKeyEvent = true;
              keyState = inputEvent.type === 'keydown' ? 1 : 0;
              keyCode = inputEvent.keyCode;
              break;
          }
        }
        if (hasMouseMove) {
          inputBufferView[InputBufferAddresses.mouseMoveFlagAddr] = 1;
          inputBufferView[InputBufferAddresses.mouseMoveXDeltaAddr] = mouseMoveX;
          inputBufferView[InputBufferAddresses.mouseMoveYDeltaAddr] = mouseMoveY;
        }
        inputBufferView[InputBufferAddresses.mouseButtonStateAddr] = mouseButtonState;
        if (hasKeyEvent) {
          inputBufferView[InputBufferAddresses.keyEventFlagAddr] = 1;
          inputBufferView[InputBufferAddresses.keyCodeAddr] = keyCode;
          inputBufferView[InputBufferAddresses.keyStateAddr] = keyState;
        }
        releaseInputLock();
        inputQueue = remainingKeyEvents;
      }
      canvas.addEventListener('mousemove', function(event) {
        inputQueue.push({type: 'mousemove', dx: event.offsetX, dy: event.offsetY});
      });
      canvas.addEventListener('mousedown', function(event) {
        inputQueue.push({type: 'mousedown'});
      });
      canvas.addEventListener('mouseup', function(event) {
        inputQueue.push({type: 'mouseup'});
      });
      window.addEventListener('keydown', function(event) {
        inputQueue.push({type: 'keydown', keyCode: event.keyCode});
      });
      window.addEventListener('keyup', function(event) {
        inputQueue.push({type: 'keyup', keyCode: event.keyCode});
      });

      if (!window.location.hash) {
        window.location.hash = "#1996/geocities.com/";
      }

      var workerConfig = {
        inputBuffer: inputBuffer,
        inputBufferSize: INPUT_BUFFER_SIZE,
        screenBuffer: screenBuffer,
        screenBufferSize: SCREEN_BUFFER_SIZE,
        videoModeBuffer: videoModeBuffer,
        videoModeBufferSize: VIDEO_MODE_BUFFER_SIZE,
        audioDataBuffer: audioDataBuffer,
        audioDataBufferSize: AUDIO_DATA_BUFFER_SIZE,
        audioBlockBufferSize: audio.bufferSize,
        audioBlockChunkSize: audioBlockChunkSize,
        screenWidth: SCREEN_WIDTH,
        screenHeight: SCREEN_HEIGHT,
        config: config,
      };

      //if (singleThreadedEmscripten) {
      var worker = new Worker('dist/bas-worker.js');

      worker.postMessage(workerConfig);

      worker.addEventListener("message", (event) => {
        if (progressTarget) {
          progressTarget.dispatchEvent(new CustomEvent("dl-progress", {detail: event.data}));
        }
      });
      //}

      function drawScreen() {
        const pixelsRGBA = imageData.data;
        const numPixels = SCREEN_WIDTH * SCREEN_HEIGHT;
        const expandedFromPalettedMode = videoModeBufferView[3];
        audioContext.currentTime;
        // if (!acquireTwoStateLock(videoModeBufferView, 9)) {
        //   console.log('skipped frame in client');
        //   return;
        // }
        // while (acquireTwoStateLock(videoModeBufferView, 9)) {
        //   if (audioContext.currentTime - start > 0.1666666) {
        //     console.warn('failed to acquire video lock, dropping frame');
        //     return;
        //   }
        // }
        if (expandedFromPalettedMode) {
          for (var i = 0; i < numPixels; i++) {
            // palette
            pixelsRGBA[i * 4 + 0] = screenBufferView[i * 4 + 0];
            pixelsRGBA[i * 4 + 1] = screenBufferView[i * 4 + 1];
            pixelsRGBA[i * 4 + 2] = screenBufferView[i * 4 + 2];
            pixelsRGBA[i * 4 + 3] = 255; // full opacity
          }
        } else {
          for (var i = 0; i < numPixels; i++) {
            // ARGB
            pixelsRGBA[i * 4 + 0] = screenBufferView[i * 4 + 1];
            pixelsRGBA[i * 4 + 1] = screenBufferView[i * 4 + 2];
            pixelsRGBA[i * 4 + 2] = screenBufferView[i * 4 + 3];
            pixelsRGBA[i * 4 + 3] = 255; // full opacity
          }
        }

        // releaseTwoStateLock(videoModeBufferView, 9);

        canvasCtx.putImageData(imageData, 0, 0);
      }

      function asyncLoop() {
        drawScreen();
        tryToSendInput();
        requestAnimationFrame(asyncLoop);
      }

      openAudio();
      asyncLoop();
    }

    class OWTBasiliskII extends LitElement
    {
      constructor() {
        super();
      }

      static get properties() {
        return {
          url: { type: String },
          ts: { type: String },
          opts: { type: Object }
        }
      }

      createRenderRoot() {
        return this;
      }

      firstUpdated() {
        bas_main({
          replayUrl: this.url,
          replayTs: this.ts,
          opts: this.opts,
          canvas: ".bas-canvas",
          width: 1024,
          height: 720,
        }, this);
      }

      render() {
        return html`
      <canvas width="640" height="480" id="canvas" class="bas-canvas" oncontextmenu="event.preventDefault()"></canvas>
    `;
      }
    }

    class OWTNative extends LitElement
    {
      static get properties() {
        return {
          url: { type: String },
          ts: { type: String },
          opts: { type: Object },
          iframeUrl: { type: String }
        }
      }

      updated(changedProps) {
        if (changedProps.has("url") || changedProps.has("ts")) {
          if (this.url && (this.url !== this.actualUrl || changedProps.has("ts"))) {
            this.dispatchEvent(new CustomEvent("load-started"));
            this.iframeUrl = `/w/live/${this.ts}mp_/${this.url}`;
          }
        }
      }

      createRenderRoot() {
        return this;
      }

      render() {
        if (!this.iframeUrl) {
          return html``;
        }

        return html`
      <iframe class="native-frame" src="${this.iframeUrl}"
      @load="${this.onFrameLoad}" allow="autoplay 'self'; fullscreen" allowfullscreen
      ></iframe> 
    `;
      }

      onFrameLoad(event) {
        const detail = {};

        try {
          //const iframe = this.renderRoot.querySelector("iframe");
          detail.url = event.currentTarget.contentWindow.WB_wombat_location.href;
          this.actualUrl = detail.url;
        } catch(e) {
          console.log(e);
        }

        this.dispatchEvent(new CustomEvent("load-finished", {detail}));
      }
    }

    //import OWTHalfixBrowser from './halfix/owt-halfix';

    const ARCHIVE_PREFIX = "https://web.archive.org/web/";

    const PROXY_PREFIX = "https://wabac-cors-proxy.webrecorder.workers.dev/proxy/";


    // ===========================================================================
    class OldWebToday extends LitElement
    {
      constructor() {
        super();

        this.emuMap = {};

        this.replayUrl = "http://example.com/";
        this.replayTs = "";
        this.inputTs = "";
        this.launchReplayUrl = "";
        this.browserID = "";
        this.launchID = "";
        this.isLoading = false;

        this.showUrlUpdateMessage = false;
        this.showTsUpdateMessage = false;

        this.emuOptions = [];
        this.emuMap = {};

        this.unsupported = (!self.BroadcastChannel || !self.SharedArrayBuffer);

        if (self.BroadcastChannel) {
          this.updateChannel = new BroadcastChannel("update-proxy");
          this.updateChannel.onmessage = () => this.onClearUpdateNeeded();
        }

        this.dlProgress = 0;
        this.dlProgressTotal = 0;

        this.inited = false;
        this.initSW();

        this.loadConfig();
      }

      async loadConfig() {
        const resp = await fetch("./assets/config.json");
        this.emuOptions = await resp.json();

        for (const emu of this.emuOptions) {
          this.emuMap[emu.id] = emu;
        }
      }

      async initSW() {
        const scope = "./";

        const hadSW = !!navigator.serviceWorker.controller;

        await navigator.serviceWorker.register("./sw.js", {scope});

        navigator.serviceWorker.addEventListener("message", (event) => {
          this.inited = true;
          if (this.unsupported && !hadSW) {
            window.location.reload();
          }
        });

        const baseUrl = new URL(window.location);
        baseUrl.hash = "";

        const msg = {
          msg_type: "addColl",
          name: "live",
          type: "live",
          file: {"sourceUrl": `proxy://live`},
          skipExisting: false,
          extraConfig: {
            "prefix": PROXY_PREFIX,
            "isLive": false,
            "archivePrefix": ARCHIVE_PREFIX,
            "injectScripts": ["dist/ruffle.js"],
            "baseUrl": baseUrl.href,
            "baseUrlHashReplay": true,
            "coHeaders": true,
          },
        };

        if (!navigator.serviceWorker.controller) {
          navigator.serviceWorker.addEventListener("controllerchange", (event) => {
            navigator.serviceWorker.controller.postMessage(msg);
          });
        } else {
          navigator.serviceWorker.controller.postMessage(msg);
        }
      }

      static get properties() {
        return {
          replayUrl: { type: String },
          replayTs: { type: String },
          inputTs: { type: String },
          isLoading: { type: Boolean },
          launchID: { type: String },
          browserID: { type: String },
          showUrlUpdateMessage: { type: Boolean },
          showTsUpdateMessage: { type: Boolean },
          emuOptions: { type: Array },
          unsupported: { type: Boolean },
          dlProgress: { type: Number },
          dlProgressTotal: { type: Number },
          inited: { type: Boolean },
        }
      }

      get isRunning() {
        return !!this.launchID;
      }

      onClearUpdateNeeded(event) {
        this.showUrlUpdateMessage = false;
        this.showTsUpdateMessage = false;
        this.isLoading = false;

        if (event && event.detail && event.detail.url) {
          this._internalUpdate = true;
          this.replayUrl = event.detail.url;
        }
      }

      onStartLoading() {
        this.showUrlUpdateMessage = false;
        this.showTsUpdateMessage = false;
        this.isLoading = true;
      }

      firstUpdated() {
        if (!window.location.hash) {
          window.location.hash = "#/19960101/http://geocities.com/";
        }

        this.parseOpts();
        window.addEventListener("hashchange", () => this.parseOpts(true));
        window.addEventListener("popstate", () => this.parseOpts());

        // start running only on initial load
        this.launchID = this.browserID;
        this.isLoading = this.isRunning;
        this.launchReplayUrl = this.replayUrl;

        this.inputTs = this.replayTs || "19960101";
      }

      updated(changedProps) {
        if (changedProps.has("replayUrl") || changedProps.has("replayTs")) {
          this.updateHash();
        }

        if (this.isRunning && !this.isLoading) {
          if (changedProps.has("replayTs")) {
            this.updateChannel.postMessage({replayTs: this.replayTs});
            this.showTsUpdateMessage = true;
          }

          if (changedProps.has("replayUrl")) {
            if (!this._internalUpdate) {
              this.updateChannel.postMessage({replayUrl: this.replayUrl});
              this.showUrlUpdateMessage = true;
            }
            this._internalUpdate = false;
          }
        }

        if (changedProps.has("browserID")) {
          this.updateQuery();
        }
      }

      createRenderRoot() {
        return this;
      }

      parseOpts(hashchange) {
        const query = new URL(window.location.href).searchParams;
        this.browserID = query.get("browser");

        const m = window.location.hash.slice(1).match(/\/?(?:([\d]+)\/)?(.*)/);
        if (m) {
          this.replayTs = m[1] || "";
          this.replayUrl = m[2] || "http://example.com/";
        }

        // if (hashchange && this.isRunning && this.replayUrl !== this.launchReplayUrl) {
        //   window.location.reload();
        // }
      }

      updateHash() {
        let string = "#";
        if (this.replayTs) {
          string += this.replayTs + "/";
        }
        string += this.replayUrl;
        window.location.hash = string;
      }

      updateQuery() {
        const url = new URL(window.location.href);
        if (this.browserID) {
          url.searchParams.set("browser", this.browserID);
        } else {
          url.searchParams.delete("browser");
        }

        //window.history.pushState({}, "OldWeb.Today Emulated Browsers", url.href);
        if (window.location.href !== url.href) {
          window.location.href = url.href;
        }
      }

      renderEmulator() {
        if (!this.launchID) {
          return html`
      <div class="err">Please <b>select a browser</b> from the list to start! Many browsers support Flash or Java emulation.</div>`;
        }

        if (!this.emuOptions.length) {
          return html`<div class="err"><div class="loading loading-lg"></div>Loading Browser Config...</div>`;
        }

        const emu = this.emuMap[this.launchID];

        if (!emu) {
          return html`<div class="err">Not a valid browser. Please select a browser.</div>`;
        }

        if (!this.inited) {
          return html`<div class="err">Initializing, please wait...</div>`;
        }

        if (this.unsupported && (emu.emu !== "native")) {
          return html`<div class="err">Sorry, OldWeb.today can not run in this emulator in your current browser. Please try the latest version of Chrome or Firefox to use this emulator.
      <br/>The Ruffle emulator may still work.</div>`;
        }

        if (emu.emu === "v86") {
          return html`
      <owt-v86-browser
      @dl-progress="${this.onDownload}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-v86-browser>`;

        } else if (emu.emu === "bas") {
          return html`
      <owt-bas-browser @dl-progress="${this.onDownload}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-bas-browser>`;

        } else if (emu.emu === "halfix") {
          return html`
      <owt-halfix-browser @dl-progress="${this.onDownload}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-halfix-browser>`;

        } else if (emu.emu === "native") {
          return html`
      <owt-native @dl-progress="${this.onDownload}"
      @load-started="${this.onStartLoading}"
      @load-finished="${this.onClearUpdateNeeded}"
      .opts="${emu.opts}" url="${this.replayUrl}" ts="${this.replayTs}">
      </owt-native>`;

        } else {
          return html`<div class="err">Unknown emulator type: ${emu.emu}</div>`;
        }
      }

      renderEmuLabel(emu) {
        return html`
    ${emu.os !== 'native' ? html`
    <img width="24" height="24" src="./assets/icons/${emu.icon}"/>
    <img style="margin-left: 1.0em" width="24" height="24" src="./assets/icons/${emu.os}.png"/>` : html`

    <span class="icon-fill"></span>
    <img width="24" height="24" src="./assets/icons/${emu.icon}"/>
    `}

    <span class="browser-label">${emu.name}</span>

    ${emu.features ? html`
    <span class="browser-features">
    ${emu.features.map((f) => html`<span>${f}</span>`)}
    </span>` : ``}
    `;
      }

      render() {
        const currEmu = this.emuMap[this.browserID];

        return html`
      <div class="container">
        <div class="columns">
          <div class="column controls">
            <div>
              <h2 class="owt-title">OldWeb.Today</h2>
              <i class="full-width" style="text-align: center; display: block">JS Browser Emulation <img src="./assets/new.gif"/></i>
              <div class="form-group">
                <label for="browser" class="form-label space-top">Browser / Emulator:</label>

                <div class="dropdown full-width browser">
                  <a class="btn dropdown-toggle" tabindex="0">
                    <span class="curr-browser">
                      ${currEmu ? this.renderEmuLabel(currEmu): 'Select a Browser'}
                      <i class="icon icon-caret" class="caret"></i>
                    </span>
                  </a>
                  <ul id="browser-menu" class="menu">
                    ${this.emuOptions.map((emu, i) => html`
                      ${emu.hidden ? html`` : html`
                      <li class="menu-item" style="">
                        <a style="display: flex" @click="${(e) => this.onSelectBrowser(e, emu)}" tabIndex="${i + 1}">
                          ${this.renderEmuLabel(emu)}
                        </a>
                      </li>`}
                    `)}
                  </ul>
                </div>

                <form @submit="${this.onUrlUpdate}" class="space-top">
                  <label class="form-label" for="url">URL:</label>
                  <input @change="${this.onUrlUpdate}" class="form-input" type="url" id="url" .value="${this.replayUrl}" placeholder="http://example.com/"></input>
                </form>

                ${this.showUrlUpdateMessage ? html`
                <div class="msg" style="background-color: aliceblue">
                  Home Page URL Updated!<br/>Click the <i>Home</i> button in the emulated browser to load the new URL.
                </div>` : html``}

                <label class="form-radio space-top">
                  <input @click="${(e) => this.replayTs = ""}" type="radio" name="islive" ?checked="${!this.replayTs}">
                  <i class="form-icon"></i>Browse Live Web
                </label>

                <label class="form-radio" style="padding-right: 0">
                  <input @click="${(e) => this.replayTs = this.inputTs}" type="radio" name="islive" ?checked="${!!this.replayTs}">
                  <i class="form-icon"></i>Browse Archives At:
                </label>

                <input @change="${this.onChangeTs}" class="form-input" type="text" id="dt" ?disabled="${!this.replayTs}"
                  .value="${this.tsToDateMin(this.inputTs)}" placeholder="YYYY-MM-DD hh:mm:ss"></input>

                ${!!this.replayTs ? html`
                <details>
                  <summary>Web Archive Sources</summary>
                  <div>
                  <label class="form-checkbox">
                    <input type="checkbox" disabled checked>
                    <i class="form-icon"></i>Internet Archive
                    <p style="font-size: 0.75em">More options coming soon...</p>
                  </label>
                  </div>
                </details>` : ``}

                ${this.showTsUpdateMessage ? html`
                  <div class="msg" style="background-color: aliceblue">
                    Date Updated!<br/>Click the <i>Refresh</i> button or load a new page in the emulated browser to start browsing at the new date.
                  </div>` : html``}

                ${this.isRunning ? html`
                  <div style="margin: 1em 0">
                    <p>${!this.isLoading ? html`
                    <i>Status: Running</i>` : html`
                    <div class="loading loading-lg"></div>
                    ${this.dlProgressTotal ? html`
                    <i>Status: Downloading...</i>
                    <progress class="progress" value="${this.dlProgress}" max="${this.dlProgressTotal}"></progress>
                    ` : html`
                    <i>Status: Loading, please wait...</i>`}
                    `}</p>

                    <button class="btn btn-sm" @click="${this.onCancel}"><i class="icon icon-cross"></i>&nbsp;Stop</button>
                    <button class="btn btn-sm" @click="${(e) => window.location.reload()}"><i class="icon icon-refresh"></i>&nbsp;Reload</button>
                  </div>
                  ` : ``}

                ${this.isRunning && this.emuMap[this.launchID] && this.emuMap[this.launchID].hidden ? html`
                <button @click="${this.onDL}">Save State</button>` : ''}
              </div>
            </div>
            <div class="by-wr">
              <p>
                <a href="https://github.com/oldweb-today/oldweb-today" target="_blank">How it Works / View Source</a>
              </p>
              <p>
                <a href="http://classic.oldweb.today/" target="_blank">Classic OldWeb.today</a>
              </p>
              <span>A project by:</span>
              <a href="https://webrecorder.net/" target="_blank">
                <img class="logo" src="assets/wrLogo.png"/>
              </a>
            </div>
          </div>
          <div class="column" style="margin-right: 0px">
            ${this.renderEmulator()}
          </div>
        </div>
      </div>
    `;
      }

      onSelectBrowser(event, emu) {
        this.browserID = emu.id;
      }

      onUrlUpdate(event) {
        event.preventDefault();
        this.replayUrl = this.renderRoot.querySelector("#url").value;
        // if (this.isRunning && this.replayUrl !== this.launchReplayUrl) {
        //   window.location.reload();
        // }
      }

      onDownload(event) {
        if (event.detail) {
          this.dlProgressTotal = event.detail.total;
          this.dlProgress = event.detail.count;
        } else {
          this.dlProgressTotal = 0;
        }
      }

      onChangeTs(event) {
        this.inputTs = event.currentTarget.value.replace(/[^\d]/g, "");
        if (this.isRunning) {
          this.replayTs = this.inputTs;
        }
      }

      tsToDateMin(ts) {
        if (!ts) {
          return "";
        }
      
        if (ts.length < 14) {
          ts += "00000101000000".substr(ts.length);
        }
      
        const datestr = (ts.substring(0, 4) + "-" +
          ts.substring(4, 6) + "-" +
          ts.substring(6, 8) + " " +
          ts.substring(8, 10) + ":" +
          ts.substring(10, 12) + ":" +
          ts.substring(12, 14));
      
        return datestr;
      };

      onCancel() {
        this.browserID = "";
      }

      onDL() {
        if (!window.emulator) {
          return;
        }

        window.emulator.stop();

        window.emulator.save_state((err, buff) => {
          if (err) {
            console.log(err);
            return;
          }

          const blob = new Blob([buff]);

          const a = document.createElement("a");
          a.download = "savestate.bin";
          a.href = window.URL.createObjectURL(blob);
          a.dataset["downloadurl"] = ["application/octet-stream", a.download, a.href].join(":");

          a.click();

          window.URL.revokeObjectURL(a.href);

          window.emulator.run();
        });
      }
    }

    customElements.define("oldweb-today", OldWebToday);
    customElements.define("owt-v86-browser", OWTV86Browser);
    customElements.define("owt-bas-browser", OWTBasiliskII);
    //customElements.define("owt-halfix-browser", OWTHalfixBrowser);
    customElements.define("owt-native", OWTNative);

})();
