/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard-scss'],
  rules: {
    // Guards for the conventions in src/styles.scss and src/styles/_mixins.scss.
    // Material is customised through its token mixins (mat.*-overrides), not !important.
    'declaration-no-important': true,
    // Use var(--accent), var(--accent-hover) and rgba(var(--accent-rgb), …). Custom properties
    // (the token definitions themselves) are exempt.
    'declaration-property-value-disallowed-list': {
      '/^(?!--)/': ['/#4a9eff/i', '/#3a8eef/i', '/74,\\s*158,\\s*255/'],
    },

    // Angular's ::ng-deep is needed for content injected with [innerHTML].
    'selector-pseudo-element-no-unknown': [true, { ignorePseudoElements: ['ng-deep'] }],
    // Allows currentColor.
    'value-keyword-case': ['lower', { camelCaseSvgKeywords: true }],

    // Notation and blank-line rules that the existing code doesn't follow. Turned off rather
    // than reformatting every stylesheet; formatting is Prettier's job.
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'color-hex-length': null,
    'font-family-name-quotes': null,
    'media-feature-range-notation': null,
    'at-rule-empty-line-before': null,
    'declaration-empty-line-before': null,
    'rule-empty-line-before': null,
    'scss/double-slash-comment-empty-line-before': null,
  },
};
