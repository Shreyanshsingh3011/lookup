# Third-party notices

## Star, constellation and star-name data — d3-celestial

`client/src/data/skyCatalog.json` is generated from the data files shipped with
[d3-celestial](https://github.com/ofrohn/d3-celestial) by
`scripts/build-sky-catalog.mjs`. The generated file is a reformatted and
reduced-precision subset of that data (stars to magnitude 6, constellation
figures, and proper names for the brightest stars); no other modification is
made to the underlying values.

The following notice is retained as required by the licence:

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Runtime dependencies

Licences for npm dependencies (including `satellite.js`, MIT, and
`astronomy-engine`, MIT) are distributed with those packages under
`node_modules/`.

## Orbital element data — Celestrak

Two-line element sets are fetched at runtime from
[Celestrak](https://celestrak.org/), which places no licence restriction on
their use. They are not redistributed in this repository.

The one exception is `server/src/fixtures.ts`, which embeds a single 2024-epoch
ISS element set as a development fallback for environments that cannot reach
Celestrak. It is flagged as `source: "fixture"` at runtime and is not valid for
real predictions.
