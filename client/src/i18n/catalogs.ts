import encommon from './locales/en/common.ts';
import necommon from './locales/ne/common.ts';
import enrooms from './locales/en/rooms.ts';
import nerooms from './locales/ne/rooms.ts';
import encallbreak from './locales/en/callbreak.ts';
import necallbreak from './locales/ne/callbreak.ts';
import enflush from './locales/en/flush.ts';
import neflush from './locales/ne/flush.ts';
import enmarriage from './locales/en/marriage.ts';
import nemarriage from './locales/ne/marriage.ts';
import enledger from './locales/en/ledger.ts';
import neledger from './locales/ne/ledger.ts';
import ensocial from './locales/en/social.ts';
import nesocial from './locales/ne/social.ts';
import enfeedback from './locales/en/feedback.ts';
import nefeedback from './locales/ne/feedback.ts';

export const uiCatalogs = {
  en: { common: encommon, rooms: enrooms, callbreak: encallbreak, flush: enflush, marriage: enmarriage, ledger: enledger, social: ensocial, feedback: enfeedback },
  ne: { common: necommon, rooms: nerooms, callbreak: necallbreak, flush: neflush, marriage: nemarriage, ledger: neledger, social: nesocial, feedback: nefeedback },
};
export type UiKey = { [G in keyof typeof uiCatalogs.en]: `${G}.${keyof typeof uiCatalogs.en[G] & string}` }[keyof typeof uiCatalogs.en];
