import 'highlight.js/styles/atom-one-dark.css';
import hljs from 'highlight.js/lib/core';
import markdownLang from 'highlight.js/lib/languages/markdown';
import jsonLang from 'highlight.js/lib/languages/json';
import xmlLang from 'highlight.js/lib/languages/xml';
import yamlLang from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('json', jsonLang);
hljs.registerLanguage('xml', xmlLang);
hljs.registerLanguage('yaml', yamlLang);

export default hljs;
