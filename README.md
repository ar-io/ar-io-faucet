# AR.IO Testnet Token Minting Service

## Overview

This service allows users to mint tokens on the AR.IO Testnet using a tokenized voucher system.

## Requesting a Token

Users can request a minting token for a recipient by sending a POST request to the `/api/request` endpoint with the recipient's address in the request body.

```bash
curl -X POST http://localhost:3000/api/request -H "Content-Type: application/json" -d '{"recipient": "recipient_address", "processId": "processId"}'
```

The service will return a token that can be used to mint the tokens on the AR.IO Testnet Network. The token is valid for 1 hour.

## Verification

Users can verify a token by sending a GET request to the `/api/verify` endpoint with the token in the query parameters.

```bash
curl -X GET http://localhost:3000/api/verify?token=token&processId=processId
```

The service will return whether the token is valid.

## Minting

Users can use a token to receive AR.IO Testnet Network tokens by sending a POST request to the `/api/mint` endpoint with the token in the request body.

```bash
curl -X POST http://localhost:3000/api/mint -H "Content-Type: application/json" -d '{"token": "token", "processId": "processId"}'
```

The service will return the transaction ID of the transfer of AR.IO Testnet Network tokens for the recipient.
