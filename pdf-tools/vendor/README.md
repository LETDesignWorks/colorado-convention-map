# PDF and PowerPoint dependencies

These files are unmodified distributions copied from the installed official packages. They are served locally so selected PDF files never need an external conversion service.

| Dependency | Pinned version | Included distribution |
| --- | --- | --- |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 4.0.1 | `pptxgenjs-4.0.1.bundle.js`, including JSZip 3.10.1 |
| [PDF.js](https://github.com/mozilla/pdfjs-dist) | 5.6.205 | Legacy minified renderer and matching worker, standard fonts, image decoders, ICC profile |
| [PDF-LIB](https://github.com/Hopding/pdf-lib) | 1.17.1 | Existing `../../load-tests/vendor/pdf-lib.min.js` |

PptxGenJS and JSZip license files are beside their bundle. PDF.js and its bundled fonts, image decoders, and color profile retain their upstream licenses in their original folders.

The optional predefined CMap collection is not included. The renderer stops on unsupported PDF content instead of producing a partially rendered presentation. The website's generated Latin-script PDFs use the included standard fonts or embedded fonts.

Reference APIs: [PDF.js document/rendering options](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [PptxGenJS layouts](https://gitbrent.github.io/PptxGenJS/docs/usage-pres-options/), [PptxGenJS saving](https://gitbrent.github.io/PptxGenJS/docs/usage-saving/), and [PDF-LIB form flattening](https://pdf-lib.js.org/docs/api/classes/pdfform#flatten).
