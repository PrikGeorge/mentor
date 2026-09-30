(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/markdown-it/markdown-it.min.js'));
  } else {
    root.MENTOR_MARKDOWN = factory(root.markdownit);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (MarkdownIt) {
  'use strict';

  const markdown = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: false,
    typographer: false
  });

  const defaultValidateLink = markdown.validateLink.bind(markdown);
  markdown.validateLink = function (destination) {
    // A note must not navigate portal hashes or authenticated relative endpoints.
    // markdown-it decodes HTML entities before validating the destination; requiring
    // a literal allowed scheme also rejects percent-encoded or disguised schemes.
    if (!defaultValidateLink(destination) || /[\u0000-\u0020\u007f\\]/.test(destination)) return false;
    if (!/^(?:https?:\/\/[^/\\]|mailto:[^?#])/i.test(destination)) return false;
    try {
      const url = new URL(destination);
      return (url.protocol === 'http:' || url.protocol === 'https:')
        ? Boolean(url.hostname)
        : url.protocol === 'mailto:' && Boolean(url.pathname);
    } catch (_) {
      return false;
    }
  };

  markdown.renderer.rules.link_open = function (tokens, index, options, env, renderer) {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderer.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.image = function (tokens, index, options, env, renderer) {
    // Keep the description while never emitting a resource-loading element.
    const alternative = renderer.renderInlineAsText(tokens[index].children || [], options, env);
    return markdown.utils.escapeHtml(alternative);
  };

  return Object.freeze({
    render(source) {
      return markdown.render(source == null ? '' : String(source));
    }
  });
});
