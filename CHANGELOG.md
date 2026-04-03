# Changelog

## [1.0.0](https://github.com/anchildress1/carbon-trace/compare/v0.0.9...v1.0.0) (2026-04-03)


### Bug Fixes

* ambient audio bleed during transitions and credits scroll stall ([#59](https://github.com/anchildress1/carbon-trace/issues/59)) ([1e2490a](https://github.com/anchildress1/carbon-trace/commit/1e2490a85680321637f3db791ec83b1669757386))


### Miscellaneous Chores

* release 1.0.0 ([4ab48b8](https://github.com/anchildress1/carbon-trace/commit/4ab48b80bb0438c8378a562d25dae96c9a84a2c7))

## [0.0.9](https://github.com/anchildress1/carbon-trace/compare/v0.0.8...v0.0.9) (2026-04-03)


### Bug Fixes

* sync caption timeline start with narration playback ([#57](https://github.com/anchildress1/carbon-trace/issues/57)) ([f3e3961](https://github.com/anchildress1/carbon-trace/commit/f3e39610fa2be2eb9a58c396e860b4bb9ab167b5))

## [0.0.8](https://github.com/anchildress1/carbon-trace/compare/v0.0.7...v0.0.8) (2026-04-02)


### Bug Fixes

* cache CSS dimensions in sizeCanvas and update remaining gradient tests ([16f8818](https://github.com/anchildress1/carbon-trace/commit/16f88186c07c8b1f688645a51bb86cbcda4d83c3))
* cache TextureSource directly to eliminate PixiJS Cache leak ([#46](https://github.com/anchildress1/carbon-trace/issues/46)) ([a0dc52d](https://github.com/anchildress1/carbon-trace/commit/a0dc52d4ce89850f1adbe686e66a920397e1d3f3))


### Performance Improvements

* ADR-007 profiling, grayscale masks, and render optimizations ([#50](https://github.com/anchildress1/carbon-trace/issues/50)) ([66395d5](https://github.com/anchildress1/carbon-trace/commit/66395d5234c35c0d3e989948562745a1f8847d6a))
* baseline profiling and mobile Lighthouse optimization ([#48](https://github.com/anchildress1/carbon-trace/issues/48)) ([80a8fb2](https://github.com/anchildress1/carbon-trace/commit/80a8fb2213a177ae82872d602f50475b8668a2af))

## [0.0.7](https://github.com/anchildress1/carbon-trace/compare/v0.0.6...v0.0.7) (2026-03-29)


### Features

* credits overlay ([#43](https://github.com/anchildress1/carbon-trace/issues/43)) ([cb4f97c](https://github.com/anchildress1/carbon-trace/commit/cb4f97c96252b1855690e9770b7467791d3648b7))

## [0.0.6](https://github.com/anchildress1/carbon-trace/compare/v0.0.5...v0.0.6) (2026-03-29)


### Features

* trace overlays ([#39](https://github.com/anchildress1/carbon-trace/issues/39)) ([746f7c7](https://github.com/anchildress1/carbon-trace/commit/746f7c738e9f6c1eb3381a201a7381ee0401b201))

## [0.0.5](https://github.com/anchildress1/carbon-trace/compare/carbon-trace-v0.0.4...carbon-trace-v0.0.5) (2026-03-28)


### Bug Fixes

* ci security deps ([#35](https://github.com/anchildress1/carbon-trace/issues/35)) ([189cf3e](https://github.com/anchildress1/carbon-trace/commit/189cf3e368ffaebc2fc4786b492cffafad293612))
* remediation pass ([#36](https://github.com/anchildress1/carbon-trace/issues/36)) ([bea0581](https://github.com/anchildress1/carbon-trace/commit/bea05819a926c9d2deb54d4da90c9b2dcc735674))

## [0.0.4](https://github.com/anchildress1/carbon-trace/compare/carbon-trace-v0.0.3...carbon-trace-v0.0.4) (2026-03-26)


### Features

* music animation ([#28](https://github.com/anchildress1/carbon-trace/issues/28)) ([e59fd80](https://github.com/anchildress1/carbon-trace/commit/e59fd807579c2b3cc67756444eb71ead208eacc6))


### Bug Fixes

* **deps:** remove npm lock file and patch picomatch/brace-expansion vulnerabilities ([#30](https://github.com/anchildress1/carbon-trace/issues/30)) ([a788cf8](https://github.com/anchildress1/carbon-trace/commit/a788cf8aa43297434798748d2ba667386697475e))

## [0.0.3](https://github.com/anchildress1/carbon-trace/compare/carbon-trace-v0.0.2...carbon-trace-v0.0.3) (2026-03-25)


### Features

* add animations ([#21](https://github.com/anchildress1/carbon-trace/issues/21)) ([3a14957](https://github.com/anchildress1/carbon-trace/commit/3a1495776325c08798fde5e62dd77b3f1625284a))
* audio text tuning ([#26](https://github.com/anchildress1/carbon-trace/issues/26)) ([01c0164](https://github.com/anchildress1/carbon-trace/commit/01c01640fed5fd600d2685dba0f5428047a9f726))

## [0.0.2](https://github.com/anchildress1/carbon-trace/compare/carbon-trace-v0.0.1...carbon-trace-v0.0.2) (2026-03-20)


### Features

* add image scenes and deps ([#4](https://github.com/anchildress1/carbon-trace/issues/4)) ([f8e5d33](https://github.com/anchildress1/carbon-trace/commit/f8e5d330dbbd54df80700c45fb2150495cd46724))
* canvas effects ([#8](https://github.com/anchildress1/carbon-trace/issues/8)) ([3e3542e](https://github.com/anchildress1/carbon-trace/commit/3e3542e249d7584808d2730e4a9ffc062dc26836))
* narration audio ([#5](https://github.com/anchildress1/carbon-trace/issues/5)) ([945d74d](https://github.com/anchildress1/carbon-trace/commit/945d74d4db32708ce30c09baf40b94d61a70acaa))
* **narration:** update re-recorded audio and caption timing ([#10](https://github.com/anchildress1/carbon-trace/issues/10)) ([06c5a40](https://github.com/anchildress1/carbon-trace/commit/06c5a408c3e6b8790953d662a7aaac8c9a148043))
* scaffold carbon-trace project ([#1](https://github.com/anchildress1/carbon-trace/issues/1)) ([d832d4d](https://github.com/anchildress1/carbon-trace/commit/d832d4d56291a5966e7426d7416f867a5fe1af88))


### Bug Fixes

* align ADR-004 and system design with Option B implementation ([#11](https://github.com/anchildress1/carbon-trace/issues/11)) ([2d0198b](https://github.com/anchildress1/carbon-trace/commit/2d0198bfc60745d59eff151f73e2eff23b803ce2))
* **ci:** add release-please config files and use default token ([#3](https://github.com/anchildress1/carbon-trace/issues/3)) ([4000d58](https://github.com/anchildress1/carbon-trace/commit/4000d582e1fd1198e19d64fa9c60c6eea17ccd7f))
* deploy implementation ([#9](https://github.com/anchildress1/carbon-trace/issues/9)) ([fac8dc4](https://github.com/anchildress1/carbon-trace/commit/fac8dc4bafde92461f548b27390e2847b9eaf855))
* **deploy:** fix nginx startup as non-root user in Cloud Run ([#13](https://github.com/anchildress1/carbon-trace/issues/13)) ([2cb07a1](https://github.com/anchildress1/carbon-trace/commit/2cb07a1996629ef200605711fd6730625bbef322))
