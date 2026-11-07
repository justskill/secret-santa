/**
 * Builds a link that opens the phone's Messages app with a text already filled in. The "?&body="
 * form is the one both iOS and Android accept. The app never sends texts itself.
 */
export function smsLink(phone: string, body: string): string {
	const number = phone.replace(/[^\d+]/g, '');
	return `sms:${number}?&body=${encodeURIComponent(body)}`;
}
