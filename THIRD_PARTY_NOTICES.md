# Third-party notices

Backseat itself is released under the MIT License (see `LICENSE`). It is built on the
open-source components below. Versions are the ones installed when this file was written;
each package's own `LICENSE` file ships inside it (`node_modules/<name>/`) and is
authoritative.

| Component | Version | License | Project |
| --- | --- | --- | --- |
| Electron (includes Chromium and Node.js) | 45.0.0 | MIT | https://github.com/electron/electron |
| @huggingface/transformers (transformers.js) | 4.3.1 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| onnxruntime-node / onnxruntime-common / onnxruntime-web | 1.30.0 | MIT | https://github.com/microsoft/onnxruntime |
| sharp (pulled in by transformers.js) | 0.35.5 | Apache-2.0 | https://sharp.pixelplumbing.com |
| @img/sharp-win32-x64 (prebuilt libvips) | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | https://github.com/lovell/sharp-libvips |
| koffi | 3.3.3 | MIT | https://koffi.dev/ |
| @modelcontextprotocol/sdk | 1.32.1 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| zod | 4.6.7 | MIT | https://zod.dev |
| @fontsource/black-han-sans (Black Han Sans) | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/black-han-sans |
| @fontsource/do-hyeon (Do Hyeon) | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/do-hyeon |
| @fontsource/jua (Jua) | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/jua |
| @fontsource/nanum-gothic (Nanum Gothic) | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/nanum-gothic |
| @fontsource/nanum-pen-script (Nanum Pen Script) | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/nanum-pen-script |
| @fontsource/noto-sans-kr (Noto Sans KR) | 5.3.1 | OFL-1.1 | https://fontsource.org/fonts/noto-sans-kr |

The Electron runtime shipped in the installer also carries Chromium's and Node.js's own
third-party licenses (`LICENSES.chromium.html` next to the executable).

## MIT License components

Electron, onnxruntime, koffi, @modelcontextprotocol/sdk and zod are licensed under the MIT
License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify, merge,
> publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
> to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

Copyright notices:

- Electron: Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc.
- onnxruntime: Copyright (c) Microsoft Corporation
- koffi: Copyright (C) 2026 Niels Martignène
- @modelcontextprotocol/sdk: Copyright (c) 2024 Anthropic, PBC
- zod: Copyright (c) 2025 Colin McDonnell

## Apache License 2.0 components

@huggingface/transformers and sharp are licensed under the Apache License, Version 2.0.
The full text is at https://www.apache.org/licenses/LICENSE-2.0 and is included in each
package's `LICENSE` file. Backseat uses them unmodified.

## LGPL component

The prebuilt libvips binaries in `@img/sharp-win32-x64` are LGPL-3.0-or-later. They are
loaded as a separate shared library, unmodified; the source and license are available at
https://github.com/lovell/sharp-libvips and https://www.gnu.org/licenses/lgpl-3.0.html.

## SIL Open Font License 1.1 (bundled fonts)

The six fonts the editor can burn into screenshots are bundled through Fontsource under the
SIL Open Font License, Version 1.1 (https://openfontlicense.org). The fonts are used
unmodified and are not sold on their own.

- Black Han Sans: Copyright 2015 The Black Han Sans Project Authors (https://github.com/zesstype/Black-Han-Sans)
- Do Hyeon: Copyright 2018 The Do Hyeon Project Authors
- Jua: Copyright 2018 The BM JUA Project Authors
- Nanum Gothic and Nanum Pen Script: Copyright © 2010 NHN Corporation. All rights reserved. Font designed by Sandoll Communications Inc.
- Noto Sans KR: Copyright Google Inc.; licensed under the SIL OFL 1.1
