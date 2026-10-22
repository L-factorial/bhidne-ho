import {ui} from '../i18n/copy.ts';
import type {UiKey} from '../i18n/catalogs.ts';
const keys: UiKey[] = [
 'common.waiting_for_the_table_service_your_form_will_stay_open_while_it_retries','common.saving','common.card_theme_saving','social.sending','feedback.reconnecting','feedback.waiting_for_the_server_to_confirm_your_action','deletion.checking','marriage.checking_marriage','marriage.checking_maal',
 'feedback.sending_your_action','feedback.confirming_your_action','feedback.please_wait_confirmation',
 'common.connection_interrupted_your_action_will_be_checked_automatically',
 'feedback.connection_interrupted_retrying','feedback.reconnecting_to_your_room','feedback.updating_chat','feedback.updating_game',
 'flush.reconnecting_updating_game','rooms.loading_tables','common.loading_bhidne_ho','common.loading_profile',
 'rooms.creating_room','rooms.creating_table','recovery.loading','ledger.loading_rooms','safety.loading','marriage.scoring_rules_are_loading',
];
export function isActivityCopy(value:string){return keys.some(key=>ui(key)===value);}
