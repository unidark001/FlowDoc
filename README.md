https://unidark001.github.io/FlowDoc/

# FlowDoc

FlowDoc is a local-first toolkit for finding hidden contract costs and organizing
freelancer tax paperwork. `contractAnalyzer.js` extracts terms and calculates
deterministic contract risk, while `scheduleCEngine.js` classifies bank
transactions for Schedule C categories. Document images use local OCR in the browser, and bank CSV files are parsed,
classified, and calculated locally. Contract text can optionally be sent to the
configured AI provider for a deeper review; personal identifiers are redacted
before that request. The deterministic browser audit remains available without
an API key.

## Local development

```bash
npm install
npm run build
npm test
npm run mock
```

Open `http://localhost:8080/tools.html`. The mock server exercises the AI result
pipeline without an external provider. For live AI, set `OPENAI_API_KEY` in a
local `.env` file and start with `npm start`; never commit that file.

This preview is educational and is not legal or tax advice. Tax calculations
are estimates and should be reviewed with a CPA.
