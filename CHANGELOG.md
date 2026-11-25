# Changelog

## [0.5.1](https://github.com/bhagavan44/json-viewer/compare/v0.5.0...v0.5.1) (2026-11-25)


### Refactoring

* move compare and schema validation into CompareService ([#97](https://github.com/bhagavan44/json-viewer/issues/97)) ([ad0ea19](https://github.com/bhagavan44/json-viewer/commit/ad0ea19c705f2018f0818da9da219e91b87fc5ae))
* move saved files into FilesService ([#96](https://github.com/bhagavan44/json-viewer/issues/96)) ([1d1dca0](https://github.com/bhagavan44/json-viewer/commit/1d1dca0e6dbe1f311bc21ca25704578565884031))
* move session save and restore into SessionService ([#93](https://github.com/bhagavan44/json-viewer/issues/93)) ([75e6293](https://github.com/bhagavan44/json-viewer/commit/75e629342c3150661a4c6c68fafdb1064879d18f))
* move share links into ShareService ([#95](https://github.com/bhagavan44/json-viewer/issues/95)) ([6b32d7a](https://github.com/bhagavan44/json-viewer/commit/6b32d7a78d1c1f848f5e5e93568324517edf3495))

## [0.5.0](https://github.com/bhagavan44/json-viewer/compare/v0.4.1...v0.5.0) (2026-11-24)


### Features

* add a report-only Content-Security-Policy header ([#86](https://github.com/bhagavan44/json-viewer/issues/86)) ([a19e295](https://github.com/bhagavan44/json-viewer/commit/a19e295fe94cd0685f94508e43fec0c631fd8329))
* enforce the Content-Security-Policy header ([#88](https://github.com/bhagavan44/json-viewer/issues/88)) ([2cd267d](https://github.com/bhagavan44/json-viewer/commit/2cd267d527ee3a3056daa32db8cb93e00bd5edc1))
* offline support and installable PWA ([#87](https://github.com/bhagavan44/json-viewer/issues/87)) ([0d6dab9](https://github.com/bhagavan44/json-viewer/commit/0d6dab98d2fbdb6ae8b87ee718dc0f1bcff6aee6))


### Performance

* lazy-load rarely used features ([#83](https://github.com/bhagavan44/json-viewer/issues/83)) ([2c4422b](https://github.com/bhagavan44/json-viewer/commit/2c4422b251b71f61a085d435e20140413de5012a))
* self-host Inter and a subset of Material Icons ([#84](https://github.com/bhagavan44/json-viewer/issues/84)) ([230b832](https://github.com/bhagavan44/json-viewer/commit/230b832c239ce4c8cff163ebcea760c00f59c3bf))

## [0.4.1](https://github.com/bhagavan44/json-viewer/compare/v0.4.0...v0.4.1) (2026-11-23)


### Bug Fixes

* load analytics only on Vercel-served hosts ([#78](https://github.com/bhagavan44/json-viewer/issues/78)) ([dea3eb6](https://github.com/bhagavan44/json-viewer/commit/dea3eb6e917bec8348714118dd3cee260716576c))


### Performance

* cache lowercased keys and values for tree text search ([#80](https://github.com/bhagavan44/json-viewer/issues/80)) ([715d892](https://github.com/bhagavan44/json-viewer/commit/715d892cad8df77435dfa7f6222a4753ccc37f29))
* copy only the Monaco files the JSON editor needs ([#82](https://github.com/bhagavan44/json-viewer/issues/82)) ([022fbcc](https://github.com/bhagavan44/json-viewer/commit/022fbcc30c364cd3df2e52ae74c7d1284ed4efce))
* store the session in IndexedDB instead of localStorage ([#81](https://github.com/bhagavan44/json-viewer/issues/81)) ([705cdd5](https://github.com/bhagavan44/json-viewer/commit/705cdd5a6065e9e24344846d3a308c34ccf47549))

## [0.4.0](https://github.com/bhagavan44/json-viewer/compare/v0.3.0...v0.4.0) (2026-11-22)


### Features

* build tree nodes lazily instead of for the whole document ([#73](https://github.com/bhagavan44/json-viewer/issues/73)) ([27a0feb](https://github.com/bhagavan44/json-viewer/commit/27a0febc6e3dd8ad15a5afb18ae616211256a2aa)), closes [#47](https://github.com/bhagavan44/json-viewer/issues/47)


### Bug Fixes

* load analytics only in production and document it in the README ([#68](https://github.com/bhagavan44/json-viewer/issues/68)) ([67c130d](https://github.com/bhagavan44/json-viewer/commit/67c130df19c9829a5ebfe1d8daf34cc6ef6887f5))

## [0.3.0](https://github.com/bhagavan44/json-viewer/compare/v0.2.0...v0.3.0) (2026-11-19)


### Features

* debounce parsing of large documents while typing ([#70](https://github.com/bhagavan44/json-viewer/issues/70)) ([75462a5](https://github.com/bhagavan44/json-viewer/commit/75462a55b63f84c06db65aec3f8ddf91857a0847))
* run Compare and schema validation of large documents in a Web Worker ([#71](https://github.com/bhagavan44/json-viewer/issues/71)) ([d3fac39](https://github.com/bhagavan44/json-viewer/commit/d3fac39d91ef5d4f8497159ea4110d7cf223a799))


### Documentation

* update Angular version mentions to 22 ([#65](https://github.com/bhagavan44/json-viewer/issues/65)) ([dc6965d](https://github.com/bhagavan44/json-viewer/commit/dc6965d7a202c630f4d18fd760ec428a8d794a45))

## [0.2.0](https://github.com/bhagavan44/json-viewer/compare/v0.1.0...v0.2.0) (2026-11-18)


### Features

* automatic versioning and version in the header ([#43](https://github.com/bhagavan44/json-viewer/issues/43)) ([f38d283](https://github.com/bhagavan44/json-viewer/commit/f38d283d81dbb3835f48eefdd2fc92e17609f5b4))


### Bug Fixes

* build on Vercel when the previous deploy commit is missing ([1676c5c](https://github.com/bhagavan44/json-viewer/commit/1676c5cd983add44787762a3f05e0552792c9abb))


### Refactoring

* clean up styles and split app component stylesheets ([#4](https://github.com/bhagavan44/json-viewer/issues/4)) ([b486614](https://github.com/bhagavan44/json-viewer/commit/b486614db9b05bd99128b8b7f106b98b4ae0f25f))
* drive tree row state with signals ([5244d99](https://github.com/bhagavan44/json-viewer/commit/5244d9954f7059999172bfbeeac01711ba5fc579))
* remove deprecated BrowserAnimationsModule ([#40](https://github.com/bhagavan44/json-viewer/issues/40)) ([0a98225](https://github.com/bhagavan44/json-viewer/commit/0a98225594e7b9d697936a0b4a7750afe67ed223))
* use default OnPush change detection and declare zoneless ([16da940](https://github.com/bhagavan44/json-viewer/commit/16da940c90844b6da9065edafbf38133edcb409c))


### Documentation

* add contributing guide, community files and templates ([14b03ca](https://github.com/bhagavan44/json-viewer/commit/14b03ca69d5c739286f1d43695417dc7ef2569e8))
