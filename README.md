# AR.IO Testnet Token Minting Service

## Overview

This service allows users to mint tokens on the AR.IO Testnet using a tokenized voucher system. It features a simple API for requesting and verifying tokens, and a second API for dripping tokens to a recipient's wallet address. Additional protections, including rate limiting and captcha support, are available but disabled by default.

## Requesting a Token

Users can request a minting token for a recipient by sending a POST request to the `/api/request` endpoint with the recipient's address in the request body. The request body must also include a `processId` which is used to identify the process that is requesting the token. Once the token is requested, it can be used to drip tokens to the recipient's wallet address via the `/api/drip` endpoint.

```bash
curl -X POST http://localhost:3000/api/request -H "Content-Type: application/json" -d '{"recipient": "recipient_address", "processId": "processId"}'
```


## Verification

Users can verify a token by sending a GET request to the `/api/verify` endpoint with the token in the query parameters. The token is verified by checking the signature of the token payload and the payload's nonce to ensure the token is valid and has not been used.

```bash
curl -X GET http://localhost:3000/api/verify?token=<token>&processId=<processId>
```


## Dripping Tokens

Users can drip tokens to a recipient by sending a POST request to the `/api/drip` endpoint with the token in the request body. Tokens are transferred to the recipient's wallet address and the token is marked as used.

```bash
curl -X POST http://localhost:3000/api/drip -H "Content-Type: application/json" -d '{"token": "token", "processId": "processId"}'
```
