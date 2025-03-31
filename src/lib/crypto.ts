import { WALLET } from '../config.js';
import { ario, arweave } from '../system.js';

interface TokenPayload {
	address: string;
	recipient: string;
	iat: number;
	exp: number;
}

/**
 * Generate a token for a recipient
 *
 * TODO: add nonce protection to prevent re-use of the same token
 * TODO: add rate limiting, i.e. limit the number of in-flight token requests
 *
 * @param recipient - The recipient of the token
 * @returns - The token
 */
export const generateToken = async (recipient: string): Promise<string> => {
	const payload = {
		address: WALLET.n,
		recipient: recipient,
	};

	const payloadString = JSON.stringify(payload);
	const signature = await arweave.crypto.sign(
		WALLET,
		Buffer.from(payloadString),
	);
	const token = Buffer.from(
		JSON.stringify({
			payload: payloadString,
			signature: Buffer.from(signature).toString('base64'),
		}),
	).toString('base64url');

	return token;
};

/**
/**
 * Verify a token and check if it has expired
 * 
 * TODO: add nonce based token verification to prevent replays
 * 
 * @param token - The token to verify
 * @returns - Whether the token is valid and has not expired
 */
export const verifyTokenAndExpiration = async (
	token: string,
): Promise<{ isValid: boolean; payload: TokenPayload }> => {
	const tokenData = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
	const { payload: payloadString, signature } = tokenData;

	const payload = JSON.parse(payloadString);
	const isValid = await arweave.crypto.verify(
		WALLET.n,
		Buffer.from(payloadString),
		Buffer.from(signature, 'base64'),
	);
	const isExpired = payload.exp < Math.floor(Date.now() / 1000);
	// TODO: verify the nonce has not been used
	return {
		isValid: isValid && !isExpired,
		payload,
	};
};

/**
 * Transfer a token from the sender to the recipient
 * @param token - The token to transfer
 * @param recipient - The recipient of the token
 * @returns - The transferred token
 */
export const transferToken = async ({
	token,
	qty,
}: {
	token: string;
	qty: number;
}): Promise<string> => {
	const { isValid, payload } = await verifyTokenAndExpiration(token);
	if (!isValid) {
		throw new Error('Invalid token');
	}

	const { recipient } = payload;

	const result = await ario.transfer({
		target: recipient,
		qty,
	});

	return result.id;
};
