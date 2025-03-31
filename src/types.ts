export interface TokenPayload {
	address: string;
	recipient: string;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
}

export interface InFlightTokenPayload extends TokenPayload {
	used: boolean;
}

export interface TokenCache {
	get(nonce: string): Promise<InFlightTokenPayload | null>;
	set(nonce: string, token: InFlightTokenPayload): Promise<void>;
	delete(nonce: string): Promise<void>;
	clear(): Promise<void>;
	size(): Promise<number>;
}
