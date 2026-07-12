<?php

return [
    'paths' => ['api/*'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_filter(array_map(
        'trim',
        explode(',', env('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000'))
    )),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // Bearer-token auth (Authorization header), not cookie/session based —
    // no need for the SPA credentialed-CORS mode.
    'supports_credentials' => false,
];
