# API Documentation Portals

## Swagger UI Customization

```javascript
// Custom Swagger UI
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./openapi.json');

const options = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "API Docs",
  customfavIcon: "/favicon.ico",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    requestInterceptor: (req) => {
      req.headers['X-Custom-Header'] = 'value';
      return req;
    },
  },
};

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
```

## Redoc (Modern Alternative)

```html
<!DOCTYPE html>
<html>
<head>
  <title>API Documentation</title>
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
</head>
<body>
  <redoc spec-url='./openapi.yaml'
    hide-download-button
    required-props-first
    native-scrollbars
    theme='{
      "colors": {
        "primary": {
          "main": "#4285F4"
        }
      },
      "typography": {
        "fontSize": "16px",
        "fontFamily": "Roboto, sans-serif"
      }
    }'>
  </redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
```

## Stoplight Elements

```javascript
import { API } from '@stoplight/elements';
import '@stoplight/elements/styles.min.css';

function App() {
  return (
    <API
      apiDescriptionUrl="./openapi.yaml"
      router="hash"
      layout="sidebar"
      tryItCredentialsPolicy="include"
    />
  );
}
```

## Quick Reference

| Tool | Protocol | Features |
|------|----------|----------|
| Swagger UI | REST | Try-it-out, auth |
| Redoc | REST | Clean, responsive |
| Stoplight | REST | Modern, mock server |
