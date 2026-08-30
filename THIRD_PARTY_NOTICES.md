# Third-party notices

Aplena 使用开源第三方组件。各组件仍受其原始许可证约束；`pnpm-lock.yaml` 与 `Cargo.lock` 是发行时实际版本的权威清单。本文件记录直接运行时组件和需要随二进制材料保留的主要归属，不替代上游许可证全文。

## Frontend runtime

| Component | Version | License |
|---|---:|---|
| React / React DOM | 19.2.8 | MIT |
| React Router DOM | 7.18.2 | MIT |
| TanStack React Query | 5.101.4 | MIT |
| React Hook Form | 7.86.0 | MIT |
| Zod | 4.4.3 | MIT |
| Tauri JavaScript API | 2.11.1 | Apache-2.0 OR MIT |
| Apache ECharts | 6.1.0 | Apache-2.0 |
| zrender | 6.1.0 | BSD-3-Clause |

Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).

zrender is Copyright (c) 2017, Baidu Inc. Its BSD 3-Clause license is reproduced below:

> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Rust runtime

The Rust application is built with Tauri 2.11.5, SQLx 0.9.0, rust_decimal 1.42.1, Tokio 1.53.1, Chrono 0.4.45 and their transitive dependencies. The locked dependency graph is predominantly available under MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0 or compatible dual-license terms; a small number of transitive packages use MPL-2.0 or offer multiple permissive choices.

Before each release, maintainers must regenerate the frontend production license inventory and inspect `cargo metadata --locked` against the committed lockfiles. A dependency with an unknown, prohibited or newly incompatible license blocks that release until reviewed.
