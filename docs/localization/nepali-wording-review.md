# English → Nepali UI wording review

Draft for discussion only. No application code, language selection, or visual theme behavior is changed.

This review uses the source inventory in `ui-copy.json`, `existing-translations.json`, and the game/room components. Repeated labels are consolidated. Capitalization-only variants use the same translation. SVG paths, CSS, protocol values, sample people’s names, real profile data, and room/table names are not UI translations. Long rules and instructional paragraphs remain outside this review.

The raw inventory is broader than this human-reviewed list: it also contains explanatory copy, obsolete/local-preview copy, and candidate internal strings. This document covers the short labels, action families, common feedback, and dynamic-message patterns; it is not a claim that all 1,251 raw candidates need translation or have been integrated.

## Wording choices to approve

Use short, conversational button labels ending in **गर्ने / हेर्ने / छान्ने**, rather than mixing those with long **गर्नुहोस्** labels. Use **तपाईँ** in status messages. This deliberately proposes shorter wording than some current translations.

| Meaning | Proposed term | Review note |
| --- | --- | --- |
| Lobby | लबी | Keep the familiar app term. |
| Room | कोठा | Could use रुम if that is more natural for your audience. |
| Table | टेबल | A game table, not a spreadsheet. |
| Player | खेलाडी | Names stay unchanged. |
| Seat | सिट | Distinguish leaving a seat from leaving a room. |
| Queue / waitlist | पालोको सूची | Same term for both existing English labels. |
| Turn | पालो | Never translate the internal turn code. |
| Hand | हातको तास | Avoid confusion with a trick. |
| Trick, in Call Break | बाजी | Please confirm this term for your players. |
| Bid, in Call Break | बोली | Button: बोली लगाउने. |
| Deal, as a numbered stage | डिल | Action “deal cards” is तास बाँड्ने. |
| Round | राउन्ड | Keep distinct from a trick and a full match. |
| Match | म्याच | “Game” remains खेल. |
| Bet, in Flush | चाल | Please confirm चाल versus दाउ for your players. |
| Fold, in Flush | प्याक | Familiar card-game term. |
| Fold, in Marriage | हात छोड्ने | Different action context from Flush. |
| Blind / Seen, in Flush | ब्लाइन्ड / तास हेरेको | Avoid the literal “अन्धा”. |
| Show, a public declaration | देखाउने | Other players see the cards after acceptance. |
| Reveal, your own face-down cards | तास खोल्ने | Distinct from declaring cards publicly. |
| Maal | माल | Keep established game terminology. |
| Dublee | डुप्ली | Confirm preferred spelling: डुप्ली / दुप्ली. |
| Tunnela | टनेला | Confirm preferred local spelling. |
| Sequence | सिक्वेन्स | Could use क्रम; सिक्वेन्स is more familiar in game talk. |
| Set | सेट | Distinct from a sequence or identical-face Tunnela. |
| Wildcard | जोकरको रूपमा चल्ने तास | Short group labels use जोकरसहित. |
| Tiplu / Jhiplu / Poplu / Alter / Man | टिप्लु / झिप्लु / पोप्लु / अल्टर / मान | Confirm local spelling, especially मान. |
| Points | अङ्क | Never assume points are rupees. |
| Poke | जिस्क्याउने | Proposed social tone; पोक is a shorter alternative. |

## 1. Shared buttons, navigation, and dialogs

| English | Proposed Nepali |
| --- | --- |
| Home | गृहपृष्ठ |
| Games / All games | खेलहरू / सबै खेलहरू |
| Friends | साथीहरू |
| Profile | प्रोफाइल |
| Back | फर्कने |
| Back to lobby | लबीमा फर्कने |
| Back to room | कोठामा फर्कने |
| Back to table | टेबलमा फर्कने |
| Back to your cards | आफ्नो तासमा फर्कने |
| Continue | अगाडि बढ्ने |
| Continue to table | टेबलमा जाने |
| Return | फर्कने |
| Return to table | टेबलमा फर्कने |
| Close / Close × | बन्द गर्ने |
| Cancel | रद्द गर्ने |
| Cancel editing | सम्पादन रद्द गर्ने |
| Confirm | पुष्टि गर्ने |
| Done | भयो |
| Done editing number | अङ्क सम्पादन भयो |
| Accept | स्वीकार गर्ने |
| Decline / Reject | अस्वीकार गर्ने |
| Yes / No | हो / होइन |
| Save | सेभ गर्ने |
| Update | अद्यावधिक गर्ने |
| Remove | हटाउने |
| Delete | मेटाउने |
| Delete permanently | सधैँका लागि मेटाउने |
| Search | खोज्ने |
| Retry | फेरि प्रयास गर्ने |
| Share / Share… | सेयर गर्ने |
| Copy | कपी गर्ने |
| Copy link | लिङ्क कपी गर्ने |
| Copy Invite Link | निमन्त्रणा लिङ्क कपी गर्ने |
| Copy game link | खेलको लिङ्क कपी गर्ने |
| Copy room link | कोठाको लिङ्क कपी गर्ने |
| Copy table link | टेबलको लिङ्क कपी गर्ने |
| Copy unavailable | कपी गर्न मिलेन |
| Sharing unavailable · table ended | टेबल सकियो · सेयर गर्न मिल्दैन |
| Open room | कोठा खोल्ने |
| Open table | टेबल खोल्ने |
| Open profile | प्रोफाइल खोल्ने |
| More | थप |
| Preferences | प्राथमिकताहरू |
| Choose an action | के गर्ने छान्ने |
| Keep playing | खेलिरहने |
| View results | नतिजा हेर्ने |
| Game history | खेलको इतिहास |
| Stats / Game stats | खेलको विवरण |
| Rules | नियमहरू |
| Config | सेटिङहरू |
| Rules and config | नियम र सेटिङहरू |
| How to play | कसरी खेल्ने |
| Recent activity | पछिल्लो गतिविधि |
| Recent game activity | खेलका पछिल्ला गतिविधि |
| Notifications | सूचनाहरू |
| Mark all as read | सबै पढिएको बनाउने |
| No activity yet. | अहिलेसम्म कुनै गतिविधि छैन। |
| You’re all caught up | सबै सूचना हेरिसक्नुभयो |
| Dismiss / Dismiss message | हटाउने / सन्देश हटाउने |
| Table menu | टेबल मेनु |
| Table Chat | टेबल च्याट |
| Players & waiting queue | खेलाडी र पालोको सूची |

## 2. Language and theme controls

| English | Proposed Nepali |
| --- | --- |
| Language | भाषा |
| English | English |
| Nepali | नेपाली |
| Switch language to {{language}} | भाषा {{language}} बनाउने |
| Theme / Table theme | थिम / टेबल थिम |
| Choose theme / Choose table theme | थिम छान्ने / टेबल थिम छान्ने |
| Current theme: {{theme}} | हालको थिम: {{theme}} |
| Classic Green | क्लासिक हरियो |
| Nepali Heritage | नेपाली सम्पदा |
| Himalayan Dusk | हिमाली साँझ |
| Green felt and polished wood | हरियो कपडा र चम्किलो काठ |
| Paral, a village house and a chautari | पराल, गाउँको घर र चौतारी |
| Mountain silhouettes beneath an evening sky | साँझको आकाशमुनि हिमालको झल्को |
| Across the app · saved on this device | सबै पृष्ठमा लागू · यस उपकरणमा सेभ हुन्छ |

Language remains independent of the selected visual theme. User-supplied names do not switch language.

## 3. Welcome and sign-in labels

Profile-editing fields remain excluded. These are the entry-page controls.

| English | Proposed Nepali |
| --- | --- |
| Welcome | स्वागत छ |
| Welcome back | फेरि स्वागत छ |
| Welcome, {{player}} | स्वागत छ, {{player}} |
| Take your seat. | आफ्नो सिटमा बसौँ। |
| Call Break, Marriage and Flush with friends. | साथीहरूसँग कल ब्रेक, म्यारिज र फ्लस। |
| Sign in | लगइन गर्ने |
| Sign up / Create account | खाता बनाउने |
| Create your account | आफ्नो खाता बनाउने |
| Sign in or create account | लगइन गर्ने वा खाता बनाउने |
| Username | प्रयोगकर्ता नाम |
| Password | पासवर्ड |
| Continue with {{provider}} | {{provider}} बाट अगाडि बढ्ने |
| Signing in with {{provider}}… | {{provider}} बाट लगइन हुँदैछ… |
| or | वा |
| Terms | सर्तहरू |
| Privacy | गोपनीयता |
| Please wait… | केही बेर पर्खनुहोस्… |
| Loading Bhidne Ho | भिड्ने हो लोड हुँदैछ |

Google, Apple, Facebook, and the Bhidne Ho brand name remain brand names.

## 4. Lobby and game selection

| English | Proposed Nepali |
| --- | --- |
| Active games | चलिरहेका खेलहरू |
| Active tables / Available tables | चलिरहेका टेबलहरू / उपलब्ध टेबलहरू |
| All / All tables | सबै / सबै टेबलहरू |
| Open seats | खाली सिटहरू |
| View all games | सबै खेल हेर्ने |
| Filter active games | चलिरहेका खेल छान्ने |
| Refresh active games | खेल सूची ताजा गर्ने |
| Retry active games | खेल सूची फेरि लोड गर्ने |
| Browse rooms | कोठाहरू हेर्ने |
| Browse all public rooms | सबै सार्वजनिक कोठा हेर्ने |
| Public rooms | सार्वजनिक कोठाहरू |
| Friends’ rooms | साथीहरूका कोठाहरू |
| Friends’ public rooms | साथीहरूका सार्वजनिक कोठाहरू |
| Your rooms | आफ्ना कोठाहरू |
| Rooms you created | आफूले बनाएका कोठाहरू |
| Joined rooms | आफू सहभागी कोठाहरू |
| Recent / Recently visited | पछिल्ला / हालै गएका कोठाहरू |
| Your recent rooms on this device. | यस उपकरणबाट हालै गएका कोठाहरू। |
| No active tables yet | अहिले कुनै टेबल चलिरहेको छैन |
| No {{game}} tables yet | अहिले {{game}} को टेबल छैन |
| No public rooms yet. | अहिलेसम्म सार्वजनिक कोठा छैन। |
| You haven’t created a room yet. | तपाईँले अहिलेसम्म कोठा बनाउनुभएको छैन। |
| Your friends haven’t made any rooms public yet. | साथीहरूले अहिलेसम्म कुनै कोठा सार्वजनिक गरेका छैनन्। |
| Loading active tables | चलिरहेका टेबलहरू लोड हुँदैछन् |
| Couldn’t load tables | टेबलहरू लोड हुन सकेनन् |
| Couldn’t refresh tables | टेबल सूची ताजा हुन सकेन |
| Continue playing | खेल जारी राख्ने |
| Choose a game / Pick your game | खेल छान्ने |
| Choose another game | अर्को खेल छान्ने |
| What are we playing? | कुन खेल खेल्ने? |
| Call Break | कल ब्रेक |
| Marriage | म्यारिज |
| Flush | फ्लस |
| Game room | खेलको कोठा |
| Enter | प्रवेश गर्ने |
| Enter game room | खेलको कोठामा जाने |
| Enter {{game}} game room | {{game}} को कोठामा जाने |
| Find your next table | खेल्ने टेबल खोज्ने |
| Ready for a round? | एक राउन्ड खेल्न तयार? |
| Ready to play? | खेल्न तयार? |
| Ready for another round? | अर्को राउन्ड खेल्न तयार? |

## 5. Room creation, membership, and privacy

| English | Proposed Nepali |
| --- | --- |
| Create / Create room / + Create room | बनाउने / कोठा बनाउने / + कोठा बनाउने |
| Make room | कोठा बनाउने |
| Room name | कोठाको नाम |
| Join / Join room | सहभागी हुने / कोठामा सहभागी हुने |
| Join with code | कोडबाट सहभागी हुने |
| Room or table code | कोठा वा टेबलको कोड |
| Room code | कोठाको कोड |
| Room code {{code}} | कोठाको कोड {{code}} |
| Room invitation | कोठाको निमन्त्रणा |
| Dismiss invitation | निमन्त्रणा हटाउने |
| Retry invitation | निमन्त्रणा फेरि खोल्ने |
| Opening invitation… | निमन्त्रणा खुल्दैछ… |
| Entering room… | कोठामा प्रवेश हुँदैछ… |
| Private / Public | निजी / सार्वजनिक |
| Room privacy | कोठाको गोपनीयता |
| Who can discover and enter this room? | यो कोठा कसले देख्न र प्रवेश गर्न पाउँछ? |
| Everyone can discover and join this room. | यो कोठा सबैले देख्न र सहभागी हुन सक्छन्। |
| Every signed-in player can see and enter it. | लगइन गरेका सबै खेलाडीले देख्न र प्रवेश गर्न सक्छन्। |
| Room member / Room members | कोठाका सदस्य / कोठाका सदस्यहरू |
| Members | सदस्यहरू |
| Members · {{count}} | सदस्यहरू · {{count}} |
| {{members}} members · {{online}} online | {{members}} सदस्य · {{online}} अनलाइन |
| {{count}} more members | थप {{count}} सदस्य |
| {{count}} online | {{count}} अनलाइन |
| Preview room members | कोठाका सदस्य हेर्ने |
| Room membership | कोठाको सदस्यता |
| Room options / More room actions | कोठाका विकल्प / कोठाका थप विकल्प |
| Room owner controls | कोठाधनीका विकल्प |
| Invite / Invite people | निमन्त्रणा दिने / साथीहरूलाई बोलाउने |
| Invite people (optional) | साथीहरूलाई बोलाउने (ऐच्छिक) |
| Invite to room | कोठामा बोलाउने |
| Invite {{player}} to room | {{player}} लाई कोठामा बोलाउने |
| Find people to invite to room | कोठामा बोलाउन साथी खोज्ने |
| Search directory / Search players | खेलाडी खोज्ने |
| Name, username, or user ID | नाम, प्रयोगकर्ता नाम वा प्रयोगकर्ता ID |
| Username or user ID | प्रयोगकर्ता नाम वा प्रयोगकर्ता ID |
| Remove {{player}} | {{player}} लाई हटाउने |
| Invitation sent. They become a member when they join. | निमन्त्रणा गयो। सहभागी भएपछि सदस्य बन्नुहुन्छ। |
| Stay in room | कोठामै बस्ने |
| Leave room | कोठा छोड्ने |
| Leave room membership | कोठाको सदस्यता छोड्ने |
| Delete room | कोठा मेटाउने |
| Confirm delete room | कोठा मेटाउने पुष्टि गर्ने |
| Are you sure? This cannot be undone. | पक्का हो? यो परिवर्तन उल्ट्याउन मिल्दैन। |
| This room was deleted by its owner. | कोठाधनीले यो कोठा मेटाउनुभयो। |
| Room chat | कोठाको च्याट |
| Room tables / Tables | कोठाका टेबलहरू / टेबलहरू |
| Room ledger | कोठाको हिसाब |
| Retry member names | सदस्यका नाम फेरि लोड गर्ने |

Placeholder examples for names should remain examples, not be translated as actual room or player names.

## 6. Table creation and entry

| English | Proposed Nepali |
| --- | --- |
| Create table / + Create table | टेबल बनाउने / + टेबल बनाउने |
| Create this table | यो टेबल बनाउने |
| + Create New Table / Start a new table | + नयाँ टेबल बनाउने / नयाँ टेबल बनाउने |
| Table name | टेबलको नाम |
| Table name (required) | टेबलको नाम (अनिवार्य) |
| Required to create a table | टेबल बनाउन आवश्यक |
| Seats / Seats at the table | सिटहरू / टेबलका सिटहरू |
| {{count}} players | {{count}} खेलाडी |
| {{seated}}/{{capacity}} seated | {{seated}}/{{capacity}} सिट भरिएका |
| {{seated}} of {{capacity}} seated | {{capacity}} मध्ये {{seated}} सिट भरिएका |
| Find player to invite / Find players to invite | बोलाउन खेलाडी खोज्ने |
| Invite players (optional) | खेलाडी बोलाउने (ऐच्छिक) |
| Invite your friends | साथीहरूलाई बोलाउने |
| Take seat | सिटमा बस्ने |
| Seat available | सिट खाली छ |
| Empty seat | खाली सिट |
| Table full | टेबल भरिएको छ |
| Join queue / Join waitlist | पालोको सूचीमा बस्ने |
| Leave waitlist | पालोको सूचीबाट हट्ने |
| Queue #{{position}} | पालो #{{position}} |
| Your waitlist position: {{position}} | सूचीमा तपाईँको पालो: {{position}} |
| Waitlist position {{position}} | सूचीमा पालो {{position}} |
| Watch | हेर्ने |
| Observing | हेरिरहेको |
| Stay as observer | दर्शक भएर बस्ने |
| Spectator view | दर्शकको दृश्य |
| Watch or join the waitlist | हेर्ने वा पालोको सूचीमा बस्ने |
| Check table status | टेबलको अवस्था हेर्ने |
| Return to table · {{tableName}} | टेबलमा फर्कने · {{tableName}} |
| Your seat {{seat}} | तपाईँको सिट {{seat}} |
| Seat {{seat}}: {{player}} | सिट {{seat}}: {{player}} |
| Invite {{player}} | {{player}} लाई बोलाउने |
| Invite a replacement | सट्टामा अर्को खेलाडी बोलाउने |
| Accept seat / Decline seat | सिट स्वीकार गर्ने / सिट अस्वीकार गर्ने |
| Seat {{seat}} is offered to you for the next match. | अर्को म्याचका लागि तपाईँलाई सिट {{seat}} दिइएको छ। |
| Ask someone to take seat {{seat}} | सिट {{seat}} मा बस्न खेलाडी बोलाउने |
| Share table / Share table invitation | टेबल सेयर गर्ने / टेबलको निमन्त्रणा सेयर गर्ने |
| Share table link or code | टेबलको लिङ्क वा कोड सेयर गर्ने |
| Shared room table code | साझा कोठाको टेबल कोड |
| Your shareable table code | सेयर गर्न मिल्ने टेबल कोड |
| No tables yet. Start a table and invite your friends. | टेबल छैन। नयाँ टेबल बनाएर साथीहरूलाई बोलाउनुहोस्। |
| Loading tables… | टेबलहरू लोड हुँदैछन्… |
| Retry loading tables / Retry table service | टेबलहरू फेरि लोड गर्ने |

## 7. Table lifecycle, host controls, and rule approval

| English | Proposed Nepali |
| --- | --- |
| Open | खुला |
| Active | चलिरहेको |
| Waiting | पर्खँदै |
| Ready | तयार |
| Ready to start | सुरु गर्न तयार |
| Playing | खेल चलिरहेको |
| Completed | पूरा भएको |
| Ended / Table ended | सकिएको / टेबल सकियो |
| Online / Offline | अनलाइन / अफलाइन |
| Waiting for players | खेलाडीहरूलाई पर्खँदै |
| Waiting for the host | आयोजकलाई पर्खँदै |
| Waiting for eligible players. | खेल्न मिल्ने खेलाडीहरूलाई पर्खँदै। |
| Waiting for a friend… | साथीलाई पर्खँदै… |
| Waiting for everyone to take a seat. | सबै खेलाडी सिटमा बस्न पर्खँदै। |
| Need at least {{count}} players | कम्तीमा {{count}} खेलाडी चाहिन्छ |
| Lock game / Lock table / Lock players | खेलाडी पक्का गर्ने |
| Players locked | खेलाडी पक्का भए |
| Roster locked · ready to start | खेलाडी पक्का भए · सुरु गर्न तयार |
| Start game | खेल सुरु गर्ने |
| Start a new game | नयाँ खेल सुरु गर्ने |
| Prepare next match | अर्को म्याच तयार गर्ने |
| Match completed · seats for the next match | म्याच सकियो · अर्को म्याचका सिटहरू |
| Leave Seat | सिट छोड्ने |
| Leave Table | टेबल छोड्ने |
| Leave previous table | अघिल्लो टेबल छोड्ने |
| Leave previous table? | अघिल्लो टेबल छोड्ने? |
| Previous table is reserved | अघिल्लो टेबलको सिट अझै आरक्षित छ |
| Previous table left. You can now take a seat here. | अघिल्लो टेबल छोडियो। अब यहाँ सिट लिन सक्नुहुन्छ। |
| Abandon match | म्याच बीचमै छोड्ने |
| Abandon active game? | चलिरहेको खेल बीचमै छोड्ने? |
| Abandon previous game | अघिल्लो खेल बीचमै छोड्ने |
| Confirm abandon match | म्याच छोड्ने पुष्टि गर्ने |
| Abandon match and leave room | म्याच र कोठा दुवै छोड्ने |
| Leave game and room | खेल र कोठा छोड्ने |
| End game / End table | खेल समाप्त गर्ने / टेबल समाप्त गर्ने |
| End this game? / End this table? | यो खेल समाप्त गर्ने? / यो टेबल समाप्त गर्ने? |
| Cancel ending table | टेबल समाप्त नगर्ने |
| This table is closed. The room is still open. | यो टेबल बन्द भयो। कोठा अझै खुला छ। |
| Propose rules & bets | नियम र दाउको प्रस्ताव गर्ने |
| Review rule change | नियमको परिवर्तन हेर्ने |
| Accept rules / Reject rules | नियम स्वीकार गर्ने / नियम अस्वीकार गर्ने |
| {{accepted}}/{{total}} accepted | {{total}} मध्ये {{accepted}} जनाले स्वीकार गरे |
| Waiting for rule approval. | नियम स्वीकृतिको प्रतीक्षामा। |
| Creator settings · save before starting | आयोजकका सेटिङ · सुरु गर्नुअघि सेभ गर्ने |
| Unsaved changes | सेभ नभएका परिवर्तनहरू |
| Reload saved rules | सेभ भएका नियम फेरि लोड गर्ने |
| Rules before starting | सुरु गर्नुअघिका नियमहरू |
| Rules locked for this game | यस खेलका नियम पक्का भइसके |
| New rules can be chosen for the next game. | अर्को खेलका लागि नयाँ नियम छान्न सकिन्छ। |

“Lock” here confirms the roster. It does not make the room private, so translating it as “कोठा बन्द गर्ने” would be misleading.

## 8. Shared hand, card, and turn labels

| English | Proposed Nepali |
| --- | --- |
| Your cards | तपाईँको तास |
| Your hand | तपाईँको हातको तास |
| Your hand · {{count}} cards | तपाईँको हात · {{count}} तास |
| {{count}} cards left | {{count}} तास बाँकी |
| {{count}} cards · Only visible to you | {{count}} तास · तपाईँले मात्र देख्नुहुन्छ |
| Your face-up cards | तपाईँका खोलिएका तास |
| Your hand is face down | तपाईँको तास उल्टो छ |
| Hidden / Hidden card | लुकाइएको / लुकाइएको तास |
| Hand options / Hand view | तासका विकल्प / तासको दृश्य |
| Grid / Card grid | पङ्क्तिमा / तास पङ्क्तिमा |
| Fan / Sorted fan / Suit fan | पङ्खाजस्तो / मिलाइएको पङ्खा / रङअनुसार पङ्खा |
| All suits | सबै रङ |
| Filter hand by suit | रङअनुसार तास छान्ने |
| Shuffle suits | तासका रङको क्रम फेर्ने |
| Spades / Clubs / Hearts / Diamonds | हुकुम / चिडी / पान / इँटा |
| Show cards | तास देखाउने |
| Hide cards | तास लुकाउने |
| Reveal cards / Reveal your hand | तास खोल्ने / आफ्नो तास खोल्ने |
| Flip all / Flip all cards | सबै खोल्ने / सबै तास खोल्ने |
| Reveal next / Reveal next card | अर्को खोल्ने / अर्को तास खोल्ने |
| Reveal card {{card}} | {{card}} खोल्ने |
| Select {{card}} | {{card}} छान्ने |
| Selected / ✓ Selected | छानिएको / ✓ छानिएको |
| Cancel card selection | तासको छनोट रद्द गर्ने |
| Expand your card area | तासको भाग ठूलो गर्ने |
| Collapse your card area | तासको भाग सानो गर्ने |
| Close your card area | तासको भाग बन्द गर्ने |
| Current turn / TURN | अहिलेको पालो / पालो |
| Your turn | तपाईँको पालो |
| {{player}}’s turn | {{player}} को पालो |
| Your turn · {{action}} | तपाईँको पालो · {{action}} |
| Your turn · return to the table | तपाईँको पालो · टेबलमा फर्कने |
| Your cards are ready · review your hand | तास तयार छ · आफ्नो हात हेर्ने |
| Player / A player | खेलाडी / एक खेलाडी |
| Player {{number}} | खेलाडी {{number}} |
| You | तपाईँ |
| {{player}} (You) | {{player}} (तपाईँ) |
| Dealer | तास बाँड्ने खेलाडी |

Keep the displayed card face and copy number as data. For example `Discard {{card}}` changes the instruction, not `D0:7H` or the actual card artwork.

## 9. Call Break actions, turns, and results

| English | Proposed Nepali |
| --- | --- |
| Shuffle / Shuffle deck / shuffle the deck | तास फिट्ने |
| Shuffling | तास फिटिँदैछ |
| Preparing the deck. | तास तयार हुँदैछ। |
| Cut / cut the deck | तास काट्ने |
| Cut in half | बीचबाट काट्ने |
| Cut or skip | काट्ने वा छोड्ने |
| Skip cut | नकाट्ने |
| Deal / Deal cards / deal the cards | तास बाँड्ने |
| Preparing the deal | तास बाँड्ने तयारी हुँदैछ |
| Accept hand | यो हात स्वीकार गर्ने |
| Request redeal | फेरि तास बाँड्न अनुरोध गर्ने |
| Review your hand | आफ्नो हात हेर्ने |
| Review your cards · Accept or request redeal | तास हेर्ने · स्वीकार गर्ने वा फेरि बाँड्न माग्ने |
| Waiting for hand review | सबैले तास हेर्न पर्खँदै |
| Bid (label) | बोली |
| Bid (action) / choose a bid | बोली छान्ने |
| Bid {{count}} | {{count}} को बोली |
| Confirm bid | बोली पक्का गर्ने |
| Increase bid / Decrease bid | बोली बढाउने / बोली घटाउने |
| Selected bid {{count}} | छानिएको बोली {{count}} |
| Your bid: {{count}}. | तपाईँको बोली: {{count}}। |
| Your turn to bid | तपाईँको बोली लगाउने पालो |
| How many tricks will you win? | कति बाजी जित्नुहुन्छ? |
| Make your call | आफ्नो बोली लगाउने |
| Bidding | बोली लाग्दैछ |
| Bidding is open | बोली लगाउन मिल्छ |
| Bid pending | बोली बाँकी |
| Bidding complete. {{message}} | बोली सकियो। {{message}} |
| Waiting for {{player}} to bid. | {{player}} को बोली पर्खँदै। |
| Bids · {{total}} total / {{available}} available tricks | बोली · जम्मा {{total}} / उपलब्ध {{available}} बाजी |
| Current deal player bids | यस डिलका खेलाडीको बोली |
| View bids and player status | बोली र खेलाडीको अवस्था हेर्ने |
| Hide bids and player status | बोली र खेलाडीको अवस्था लुकाउने |
| Previous bids / Next bids | अघिल्ला बोली / पछिल्ला बोली |
| Play / Play a card | तास खेल्ने |
| Play {{card}} | {{card}} खेल्ने |
| Your turn to play a card | तपाईँको तास खेल्ने पालो |
| Your turn · choose a card | तपाईँको पालो · तास छान्ने |
| Next turn | अर्को पालो |
| You lead first. | पहिलो तास तपाईँले खेल्ने। |
| {{player}} leads first. | पहिलो तास {{player}} ले खेल्ने। |
| Current trick | अहिलेको बाजी |
| Last trick | अघिल्लो बाजी |
| Last trick - {{player}} won | अघिल्लो बाजी — {{player}} ले जित्नुभयो |
| {{player}} wins trick {{number}} | बाजी {{number}} मा {{player}} विजेता |
| Trick {{number}} · {{player}} won | बाजी {{number}} · {{player}} विजेता |
| {{done}}/{{total}} tricks completed | {{total}} मध्ये {{done}} बाजी सकिए |
| Tricks / Taken / Won | बाजीहरू / लिएका बाजी / जितेका बाजी |
| Won {{won}} · Need {{needed}} | जितेका {{won}} · अझै {{needed}} चाहिने |
| Met (bid) | बोली पुग्यो |
| Cannot reach bid | बोली पुर्‍याउन सम्भव छैन |
| missed bid | बोली पुगेन |
| Led / led this trick | पहिलो तास खेलेको |
| All hands played | सबैको तास सकियो |
| Current deal | अहिलेको डिल |
| Deal {{number}} | डिल {{number}} |
| Deal {{number}} of 5 | ५ मध्ये डिल {{number}} |
| Deal complete / Deal {{number}} complete | डिल सकियो / डिल {{number}} सकियो |
| Start next deal | अर्को डिल सुरु गर्ने |
| Match complete | म्याच सकियो |
| Scores | अङ्कहरू |
| Final scores | अन्तिम अङ्कहरू |
| Round complete · Call Break | राउन्ड सकियो · कल ब्रेक |
| Completed trick history | सकिएका बाजीको इतिहास |
| Completed tricks will appear here. | सकिएका बाजी यहाँ देखिन्छन्। |
| Allow no spades redeal | हुकुम नभए फेरि बाँड्न दिने |
| Redeal with no spades | हुकुम नभए फेरि बाँड्ने |
| Allow weak hand redeal | कमजोर हातमा फेरि बाँड्न दिने |
| Redeal with no card above Jack | गुलामभन्दा ठूलो तास नभए फेरि बाँड्ने |
| No cards in your hand. | तपाईँको हातमा तास छैन। |
| No {{suit}} left. Choose another suit. | {{suit}} बाँकी छैन। अर्को रङ छान्ने। |
| Follow {{suit}} if you can. | सम्भव भए {{suit}} को तास खेल्ने। |
| {{count}} revealed | {{count}} तास खोलिए |

For Call Break, **Won** means tricks won in the hand, not automatically that the player won the whole match. Its translation must follow the screen context.

## 10. Flush actions and state

| English | Proposed Nepali |
| --- | --- |
| Blind | ब्लाइन्ड |
| Seen | तास हेरेको |
| Blind · See cards when eligible | ब्लाइन्ड · मिल्दा तास हेर्ने |
| See cards | तास हेर्ने |
| Tap to see cards | तास हेर्न थिच्ने |
| Tap to hide cards | तास लुकाउन थिच्ने |
| Bet (action) | चाल लगाउने |
| Bet (label) | चाल |
| Blind bet | ब्लाइन्ड चाल |
| Bet minimum · {{points}} points | न्यूनतम चाल · {{points}} अङ्क |
| Bet double · {{points}} points | दोब्बर चाल · {{points}} अङ्क |
| Double | दोब्बर |
| Bets {{count}} / {{count}} bets | चाल {{count}} / {{count}} चाल |
| Bet history | चालको इतिहास |
| Fold / Pack | प्याक गर्ने |
| Folded | प्याक गरेको |
| {{player}} folded | {{player}} ले प्याक गर्नुभयो |
| Show | शो गर्ने |
| Show · {{points}} points | शो गर्ने · {{points}} अङ्क |
| Private side-show | निजी साइड शो |
| Request side-show | साइड शो माग्ने |
| Accept side-show | साइड शो स्वीकार गर्ने |
| Decline side-show | साइड शो अस्वीकार गर्ने |
| Accept or decline {{player}}’s side-show | {{player}} को साइड शो स्वीकार वा अस्वीकार गर्ने |
| Side-show: {{status}} | साइड शो: {{status}} |
| Final show | अन्तिम शो |
| View final show | अन्तिम शो हेर्ने |
| Reveal or fold | तास देखाउने वा प्याक गर्ने |
| {{player}} can fold or reveal their cards. | {{player}} ले प्याक गर्न वा तास देखाउन सक्नुहुन्छ। |
| {{player}}’s shown hand | {{player}} ले देखाएको तास |
| Opponent card | अर्को खेलाडीको तास |
| Your card | तपाईँको तास |
| {{player}} shown card | {{player}} ले देखाएको तास |
| Flip {{player}}’s cards | {{player}} को तास खोल्ने |
| Seated | सिटमा बसेको |
| Empty | खाली |
| Total / TOTAL POT | जम्मा / जम्मा पोट |
| Payout | पाउने अङ्क |
| You lost | तपाईँ हार्नुभयो |
| You stay | तपाईँ खेलमै रहनुभयो |
| Round {{number}} | राउन्ड {{number}} |
| Round result | राउन्डको नतिजा |
| Round complete | राउन्ड सकियो |
| View round result | राउन्डको नतिजा हेर्ने |
| Results appear after the first round. | पहिलो राउन्डपछि नतिजा देखिन्छ। |
| Bets appear after the game starts. | खेल सुरु भएपछि चालहरू देखिन्छन्। |
| Why are some actions unavailable? | केही चाल किन चल्न मिल्दैन? |
| Hide action help | चालसम्बन्धी मद्दत लुकाउने |
| Waiting for the creator to lock the table. | आयोजकले खेलाडी पक्का गर्न पर्खँदै। |
| Reconnecting… Updating game | फेरि जोडिँदै… खेल अद्यावधिक हुँदैछ |

The current source uses **Bet minimum / Bet double** for Flush. If Call/Raise labels are introduced later, they need their own context review; this list does not assume they already exist.

## 11. Flush settings labels — not the long rules

| English | Proposed Nepali |
| --- | --- |
| Flush rules | फ्लसका नियम |
| Propose Flush rules | फ्लसका नियम प्रस्ताव गर्ने |
| Allow private side-show | निजी साइड शो गर्न दिने |
| Boot per player (0 disables) | प्रतिखेलाडी बुट (० राखे लाग्दैन) |
| Personal bets before side-show | साइड शोअघि आफैँले लगाउनुपर्ने चाल |
| Seen bet multiplier | तास हेरेपछिको चालको गुणक |
| Personal blind bets before show | शोअघि आफैँले लगाउनुपर्ने ब्लाइन्ड चाल |
| Blind show: at most N active players | ब्लाइन्ड शो: बढीमा N सक्रिय खेलाडी |
| Allow blind show | ब्लाइन्ड शो गर्न दिने |
| Allow seen show | तास हेरेपछि शो गर्न दिने |
| Show only with two players | दुई खेलाडी बाँकी हुँदा मात्र शो |
| Minimum players / Maximum players | न्यूनतम खेलाडी / अधिकतम खेलाडी |
| Show cost multiplier (0 is free) | शोको लागत गुणक (० राखे निःशुल्क) |
| Ace sequence order | एक्काको सिक्वेन्स क्रम |
| AKQ first, A23 second | AKQ पहिलो, A23 दोस्रो |
| A23 first / A23 lowest | A23 पहिलो / A23 सबैभन्दा तल |
| Equal hands | बराबर हात |
| Show requester loses | शो माग्ने खेलाडी हार्ने |
| Split pot | पोट बाँड्ने |

Keep `AKQ`, `A23`, and the actual numeric setting values as game notation. Any Devanagari-number choice is a separate formatting decision.

## 12. Marriage turn actions and hand controls

| English | Proposed Nepali |
| --- | --- |
| Your turn · Draw a card | तपाईँको पालो · तास तान्ने |
| Your turn · Select a card to discard | तपाईँको पालो · फाल्ने तास छान्ने |
| Your turn · Confirm discard | तपाईँको पालो · तास फाल्ने पक्का गर्ने |
| Your turn · Finish round | तपाईँको पालो · राउन्ड टुङ्ग्याउने |
| Your turn · take a card | तपाईँको पालो · तास लिने |
| Your turn · show, finish, or discard | तपाईँको पालो · देखाउने, टुङ्ग्याउने वा तास फाल्ने |
| Waiting for turn | पालो पर्खँदै |
| Take stock · {{count}} | डेकबाट तान्ने · {{count}} |
| Take discard | फालिएको तास लिने |
| Tap to take from deck | डेकबाट तान्न थिच्ने |
| Tap to take from discard | फालिएको तास लिन थिच्ने |
| Taking a card / Taking card… | तास लिँदै / तास लिँदै… |
| Deck · {{count}} | डेक · {{count}} |
| Discard pile | फालिएका तासको थुप्रो |
| Last discard | पछिल्लो फालिएको तास |
| Just drawn / NEW | भर्खर तानिएको / नयाँ |
| You drew {{card}} | तपाईँले {{card}} तान्नुभयो |
| Select a card to discard | फाल्ने तास छान्ने |
| Discard {{card}} | {{card}} फाल्ने |
| Confirm your discard below | तल तास फाल्ने पुष्टि गर्ने |
| Card moving to discard | तास फालिँदैछ |
| Card moving to player | तास खेलाडीको हातमा जाँदैछ |
| Tap to select | छान्न थिच्ने |
| Fold | हात छोड्ने |
| Confirm fold | हात छोड्ने पुष्टि गर्ने |
| Folding | हात छोड्दै |
| Folded · Watching this round | हात छोडियो · यो राउन्ड हेर्दै |
| Fold this round? You can keep watching. | यो राउन्डको हात छोड्ने? हेर्न जारी राख्न सक्नुहुन्छ। |
| Finish round | राउन्ड टुङ्ग्याउने |
| Confirm finish | टुङ्ग्याउने पुष्टि गर्ने |
| Show Marriage | म्यारिज देखाउने |
| Confirm & show | पक्का गरेर देखाउने |

## 13. Marriage initial Tunnela declaration

| English | Proposed Nepali |
| --- | --- |
| Initial Tunnelas | सुरुमा परेका टनेला |
| Initial Tunnelas shown | सुरुका टनेला देखाइए |
| Declare your initial Tunnelas | सुरुमा परेका टनेला घोषणा गर्ने |
| Choose Tunnelas to show | देखाउने टनेला छान्ने |
| Show selected Tunnelas | छानिएका टनेला देखाउने |
| Declare no Tunnela | टनेला छैन भन्ने |
| No Tunnela · Declare none | टनेला छैन · घोषणा गर्ने |
| Tunnela detected · Choose to show | टनेला भेटियो · देखाउन छान्ने |
| Tunnela {{number}} | टनेला {{number}} |
| Reveal cards to check Tunnela | टनेला जाँच्न तास खोल्ने |
| Recording declaration… | घोषणा दर्ता हुँदैछ… |
| Declaration recorded · waiting for other players. | घोषणा दर्ता भयो · अरू खेलाडीलाई पर्खँदै। |
| Waiting for Tunnela declarations | टनेला घोषणाहरू पर्खँदै |
| {{player}} showed initial Tunnelas | {{player}} ले सुरुका टनेला देखाउनुभयो |
| declared Tunnelas before play. | खेल सुरु हुनुअघि टनेला घोषणा गर्नुभयो। |

Showing initial Tunnelas is not the same as qualifying to see Maal. The two announcements must remain distinct.

## 14. Marriage pre-Maal helper and qualification

| English | Proposed Nepali |
| --- | --- |
| Your path to Maal | माल हेर्न पुग्ने बाटो |
| Maal | माल |
| Maal hidden / Maal not seen | माल लुकाइएको / माल हेरेको छैन |
| Maal seen | माल हेरिसकेको |
| Seeing Maal | माल हेर्ने |
| View Maal | माल हेर्ने |
| Tap to see the Maal | माल हेर्न थिच्ने |
| Tap to hide the Maal | माल लुकाउन थिच्ने |
| Checking Maal… | माल हेर्न मिल्छ कि जाँच्दै… |
| Reveal cards to check Maal | माल हेर्न मिल्छ कि जाँच्न तास खोल्ने |
| Maal not eligible | माल हेर्न अझै पुगेन |
| Maal eligible · Show for Maal | माल हेर्न पुग्यो · तास देखाउने |
| Maal eligible · View options | माल हेर्न पुग्यो · विकल्प हेर्ने |
| Eligible to see Maal · {{count}} combinations ready | माल हेर्न पुग्यो · {{count}} मिलान तयार |
| A qualifying declaration is ready | माल हेर्न पुग्ने मिलान तयार छ |
| Both routes qualify — your choice | दुवै बाटोबाट माल हेर्न पुग्यो — आफैँ छान्ने |
| Choose your route to Maal | माल हेर्ने बाटो छान्ने |
| Choose cards to show | देखाउने तास छान्ने |
| Cards to show · {{count}} | देखाउने तास · {{count}} |
| 3 sequences / Tunnelas | ३ सिक्वेन्स / टनेला |
| Three sequences / Tunnelas | तीन सिक्वेन्स / टनेला |
| Three melds | तीन मिलान |
| 7 Dublees / Seven Dublees | ७ डुप्ली / सात डुप्ली |
| Sequence / Tunnela | सिक्वेन्स / टनेला |
| Sequence | सिक्वेन्स |
| Tunnela | टनेला |
| Dublee | डुप्ली |
| Natural groups | जोकर नचाहिने मिलान |
| Have: {{cards}} | हातमा: {{cards}} |
| NEED / Needed {{card}} | चाहिने / चाहिने तास {{card}} |
| Need: {{cards}} | चाहिने: {{cards}} |
| {{count}} more cards needed | अझै {{count}} तास चाहिन्छ |
| {{held}}/{{total}} held | {{total}} मध्ये {{held}} तास हातमा |
| {{ready}}/{{total}} groups ready | {{total}} मध्ये {{ready}} मिलान तयार |
| {{route}} progress | {{route}} को प्रगति |
| Need a new matching pair. | अर्को उस्तै तासको जोडी चाहिन्छ। |
| Need a new natural sequence or Tunnela. | अर्को जोकरबिनाको सिक्वेन्स वा टनेला चाहिन्छ। |
| Both routes need the same number of additional cards. | दुवै बाटोलाई बराबर थप तास चाहिन्छ। |
| {{route}} needs fewer additional cards from this hand. | यस हातबाट {{route}} का लागि कम थप तास चाहिन्छ। |
| Outside this plan · {{count}} cards | यस मिलानबाहिर · {{count}} तास |
| Select {{kind}} group {{number}} in my hand | हातमा {{kind}} को मिलान {{number}} छान्ने |
| Combination {{number}} of {{total}} | {{total}} मध्ये मिलान {{number}} |
| Option {{number}} of {{total}} | {{total}} मध्ये विकल्प {{number}} |
| Previous combination / Next combination | अघिल्लो मिलान / अर्को मिलान |
| Previous option / Next option | अघिल्लो विकल्प / अर्को विकल्प |
| Review this combination | यो मिलान हेर्ने |
| Review 3 sequences / Tunnelas | ३ सिक्वेन्स / टनेला जाँच्ने |
| Review 7 Dublees | ७ डुप्ली जाँच्ने |
| Ready to review and show | जाँचेर देखाउन तयार |
| Not shown / Already shown | नदेखाइएको / देखाइसकेको |
| ✓ Maal unlocked / ✦ Maal unlocked | ✓ माल खुल्यो / ✦ माल खुल्यो |
| {{player}} unlocked Maal | {{player}} ले माल खोल्नुभयो |
| Your hand no longer qualifies. Go back to your cards. | अहिलेको हातबाट पुग्दैन। आफ्नो तासमा फर्कने। |

## 15. Marriage after Maal: Dublee and normal finish

| English | Proposed Nepali |
| --- | --- |
| Your eighth Dublee | तपाईँको आठौँ डुप्ली |
| Track eighth Dublee | आठौँ डुप्लीको अवस्था हेर्ने |
| Waiting for a matching card | जोडी मिल्ने तास पर्खँदै |
| Cards waiting for a partner | जोडी नपुगेका तास |
| Need another {{card}}. | अर्को {{card}} चाहिन्छ। |
| Ready pairs | तयार जोडीहरू |
| Eighth Dublee ready | आठौँ डुप्ली तयार |
| Dublee finish | डुप्लीबाट खेल टुङ्ग्याउने |
| Winning eighth pair | जिताउने आठौँ जोडी |
| Seven previously shown Dublees | पहिले देखाइएका सात डुप्ली |
| Locked qualification cards | माल हेर्न देखाएका पक्का तास |
| Man cannot form a natural Dublee. | मानबाट प्राकृतिक डुप्ली बन्दैन। |
| {{card}} cannot form a new pair: the other two copies are already locked. | {{card}} को नयाँ जोडी बन्दैन: बाँकी दुई प्रति पहिले नै पक्का छन्। |
| Visible discard {{card}} completes an eighth pair. | फालिएको {{card}} ले आठौँ जोडी पूरा गर्छ। |
| Your path to a winning hand | जित्ने हात बनाउने बाटो |
| Plan winning hand | जित्ने हात मिलाउने |
| Cards outside these groups | यी मिलानबाहिरका तास |
| Suggested completed groups | सुझाइएका तयार मिलान |
| {{covered}}/{{target}} remaining cards grouped | बाँकी {{target}} मध्ये {{covered}} तास मिलाइए |
| One-card gaps among the remaining cards | बाँकी तासमा एक तास थपे पुग्ने मिलान |
| Sequence (wildcards) | सिक्वेन्स (जोकरसहित) |
| Set | सेट |
| a wildcard | जोकरको रूपमा चल्ने तास |
| Suggested final discard | अन्त्यमा फाल्न सुझाइएको तास |
| Final discard | अन्तिम फाल्ने तास |
| Final discard: {{card}} | अन्तिम फाल्ने तास: {{card}} |
| Final discard · excluded from scoring | अन्तिम फालिएको तास · अङ्कमा गनिँदैन |
| Remaining in your hand · {{count}} cards | हातमा बाँकी · {{count}} तास |
| Winning groups ready | जित्ने मिलान तयार |
| Checking Marriage… | म्यारिज पुगेको जाँच्दै… |
| Reveal cards to check Marriage | म्यारिज जाँच्न तास खोल्ने |
| Marriage not eligible | म्यारिज अझै पुगेन |
| Marriage eligible · Show Marriage | म्यारिज पुग्यो · देखाउने |
| Marriage eligible · View options | म्यारिज पुग्यो · विकल्प हेर्ने |
| Review finish | टुङ्ग्याउनुअघि जाँच्ने |
| View winning hand | जित्ने हात हेर्ने |
| Winning hand / Your winning cards | जित्ने हात / तपाईँका जित्ने तास |
| Winning after Maal | माल हेरेपछि जित्ने |
| Visible discard {{card}} helps: {{before}} → {{after}} cards needed. | फालिएको {{card}} काम लाग्छ: चाहिने तास {{before}} → {{after}}। |
| improves coverage to {{covered}}/{{target}} cards | {{target}} मध्ये {{covered}} तास मिल्छन् |
| completes a winning hand | जित्ने हात पूरा हुन्छ |
| You can take it using the draw control. | तास लिने बटनबाट यो लिन सक्नुहुन्छ। |
| Wait until the draw action allows it. | तास लिन मिल्ने समयसम्म पर्खने। |
| Wait until the server allows this draw. | सर्भरले यो तास लिन अनुमति नदिएसम्म पर्खने। |
| You can show after drawing on your turn. | आफ्नो पालोमा तास तानेपछि देखाउन सक्नुहुन्छ। |
| You can show Marriage when finishing is allowed on your turn. | आफ्नो पालोमा खेल टुङ्ग्याउन मिल्दा म्यारिज देखाउन सक्नुहुन्छ। |

## 16. Marriage table announcements and results

| English | Proposed Nepali |
| --- | --- |
| Shown cards | देखाइएका तास |
| View shown cards | देखाइएका तास हेर्ने |
| {{player}}’s shown cards | {{player}} ले देखाएका तास |
| View {{player}}’s shown cards | {{player}} ले देखाएका तास हेर्ने |
| showed 3 sequences / Tunnelas. | ३ सिक्वेन्स / टनेला देखाउनुभयो। |
| showed 7 Dublees. | ७ डुप्ली देखाउनुभयो। |
| completed the 8th Dublee. | आठौँ डुप्ली पूरा गर्नुभयो। |
| completed a winning hand. | जित्ने हात पूरा गर्नुभयो। |
| {{player}} won the round! | {{player}} ले राउन्ड जित्नुभयो! |
| 🏆 Round won! | 🏆 राउन्ड जित्नुभयो! |
| Winner | विजेता |
| Winner: {{player}} | विजेता: {{player}} |
| Game result / Round results | खेलको नतिजा / राउन्डको नतिजा |
| Winning declaration | जित्ने घोषणाको तास |
| won because all other players folded. | अरू सबैले हात छोडेकाले जित्नुभयो। |
| Marriage complete · view the result | म्यारिज सकियो · नतिजा हेर्ने |
| Marriage · the table has updated | म्यारिज · टेबल अद्यावधिक भयो |
| Winning pair unavailable in this snapshot. | अहिलेको विवरणमा जित्ने जोडी उपलब्ध छैन। |
| Player stats appear when the game starts. | खेल सुरु भएपछि खेलाडीको विवरण देखिन्छ। |

In full announcements, the name is a placeholder: `{{player}} ले ७ डुप्ली देखाउनुभयो।` Do not translate the player's name or assemble this by simply appending an English sentence fragment.

## 17. Marriage points and short scoring settings

| English | Proposed Nepali |
| --- | --- |
| Points | अङ्क |
| Scoring rules | अङ्कका नियम |
| Propose scoring rules | अङ्कका नियम प्रस्ताव गर्ने |
| Scoring rules are loading. | अङ्कका नियम लोड हुँदैछन्। |
| How the points were calculated | अङ्क कसरी हिसाब भयो |
| Maal points: {{points}} | मालका अङ्क: {{points}} |
| Own Maal: {{points}} | आफ्नो माल: {{points}} |
| Total Maal: {{points}} | जम्मा माल: {{points}} |
| Maal net | मालको खुद हिसाब |
| Winner payment: {{points}} | विजेतालाई दिने: {{points}} |
| Tunnela bonus | टनेलाको थप अङ्क |
| Tunnela bonus applies to | टनेलाको थप अङ्क लागू हुने |
| Extra points per Tunnela | प्रति टनेला थप अङ्क |
| Initial Tunnela declaration: {{count}} | सुरुमा घोषित टनेला: {{count}} |
| Initially declared Tunnelas | सुरुमा घोषणा गरिएका टनेला |
| Shown Tunnelas | देखाइएका टनेला |
| All final Tunnelas | अन्तिम हातका सबै टनेला |
| Extra per loser: Dublee win | डुप्ली जित्दा प्रतिहारेका खेलाडीबाट थप |
| Loser payment: Maal seen | हारेको भुक्तानी: माल हेरेको |
| Loser payment: Maal unseen | हारेको भुक्तानी: माल नहेरेको |
| Maal points: all players | मालका अङ्क: सबै खेलाडी |
| Maal points: seen players only | मालका अङ्क: माल हेरेका खेलाडी मात्र |
| all players / seen players only | सबै खेलाडी / माल हेरेका खेलाडी मात्र |
| Marriage combination | म्यारिज मिलान |
| House bonus (default) | हाउस बोनस (पूर्वनिर्धारित) |
| Simple points | सरल अङ्क |
| Totals for 1 / 2 / 3 copies or combinations | १ / २ / ३ प्रति वा मिलानको जम्मा |
| None / Off / On | कुनै छैन / बन्द / चालु |
| No scoring cards. | अङ्क आउने तास छैन। |
| Maal points are not counted because Maal was not seen. | माल नहेरेकाले मालका अङ्क गनिँदैनन्। |
| {{item}} × {{count}}: {{points}} points | {{item}} × {{count}}: {{points}} अङ्क |
| Net: {{maal}} + ({{payment}}) = {{total}} | खुद हिसाब: {{maal}} + ({{payment}}) = {{total}} |

## 18. Results, ledger, and settlements

| English | Proposed Nepali |
| --- | --- |
| Ledger | हिसाब |
| Ledger & settlements | हिसाब र हिसाब मिलान |
| Balances | बाँकी हिसाब |
| My settlements | मेरो हिसाब मिलान |
| Room results | कोठाका नतिजाहरू |
| Net | खुद हिसाब |
| Player / From / To | खेलाडी / दिने / पाउने |
| Amount / Status | परिमाण / अवस्था |
| Payment | भुक्तानी |
| Suggested | प्रस्तावित |
| Awaiting payment | भुक्तानीको प्रतीक्षामा |
| Awaiting confirmation | पुष्टिको प्रतीक्षामा |
| Resolved | हिसाब मिलिसकेको |
| To pay / To receive | तिर्नुपर्ने / पाउनुपर्ने |
| Two-party summary | दुई जनाबीचको हिसाब |
| Start table settlement | टेबलको हिसाब मिलान सुरु गर्ने |
| Settle game | खेलको हिसाब मिलाउने |
| In settlement | हिसाब मिलाउँदै |
| Open (settlement) | हिसाब बाँकी |
| Mark paid | तिरेको जनाउने |
| Confirm received | पाएको पुष्टि गर्ने |
| No completed game results yet. | सकिएका खेलको नतिजा छैन। |
| Show room/table codes | कोठा/टेबलको कोड देखाउने |
| Hide room/table codes | कोठा/टेबलको कोड लुकाउने |
| Game {{number}} | खेल {{number}} |
| {{count}} games | {{count}} खेल |
| {{player}} pays first | पहिले {{player}} ले तिर्ने |
| {{place}} place payment | {{place}} स्थानको भुक्तानी |
| Placement bets · paid to first place | स्थानअनुसार दाउ · पहिलो स्थानलाई दिने |
| {{payer}} → {{payee}} · {{amount}} | {{payer}} → {{payee}} · {{amount}} |
| Game results and records only. Payments happen outside Bhidne Ho. | यहाँ नतिजा र हिसाब मात्र राखिन्छ। भुक्तानी भिड्ने होबाहिर हुन्छ। |

The actual amounts, signed scores, table names, and player names remain data. “Amount” is not automatically “रकम” unless the product explicitly uses currency in that view.

## 19. Friends, invitations, and notifications

| English | Proposed Nepali |
| --- | --- |
| Your friends | तपाईँका साथीहरू |
| Add friend | साथी बनाउने |
| Already connected | पहिले नै साथी हुनुहुन्छ |
| Find players | खेलाडी खोज्ने |
| Username or display name | प्रयोगकर्ता नाम वा देखिने नाम |
| Requests received / Requests sent | आएका अनुरोध / पठाइएका अनुरोध |
| No friends yet. | अहिलेसम्म साथी छैनन्। |
| Message | सन्देश पठाउने |
| Message {{player}} | {{player}} लाई सन्देश पठाउने |
| Game invitation | खेलको निमन्त्रणा |
| {{player}} invited you to {{tableName}}. | {{player}} ले तपाईँलाई {{tableName}} मा बोलाउनुभयो। |
| sent you a connection request. | तपाईँलाई साथी बन्न अनुरोध पठाउनुभयो। |
| accepted your connection request. | तपाईँको साथी बन्ने अनुरोध स्वीकार गर्नुभयो। |
| declined your connection request. | तपाईँको साथी बन्ने अनुरोध अस्वीकार गर्नुभयो। |
| Requests and social updates | अनुरोध र साथीहरूका गतिविधि |
| Friend and room activity will appear here. | साथी र कोठाका गतिविधि यहाँ देखिन्छन्। |

## 20. Chat, pokes, and saved phrases

| English | Proposed Nepali |
| --- | --- |
| Chat | च्याट |
| Chat · paused / Chat is paused | च्याट · रोकिएको / च्याट रोकिएको छ |
| Paused | रोकिएको |
| Chat with {{player}} | {{player}} सँग च्याट |
| Table message | टेबलको सन्देश |
| Send | पठाउने |
| Sending… | पठाउँदै… |
| Send chat message | च्याट सन्देश पठाउने |
| Send table message | टेबलमा सन्देश पठाउने |
| Send privately | निजी सन्देश पठाउने |
| Write a private message | निजी सन्देश लेख्ने |
| No messages yet | अहिलेसम्म सन्देश छैन |
| {{count}} new / {{count}} unread messages | {{count}} नयाँ / {{count}} नपढिएका सन्देश |
| Chat sound on / Chat sound off | च्याटको आवाज चालु / च्याटको आवाज बन्द |
| Chat is paused while you are playing. | तपाईँ खेलिरहँदा च्याट रोकिएको छ। |
| Waiting players can read. Take a seat to chat. | पालो पर्खेकाले पढ्न सक्छन्। च्याट गर्न सिटमा बस्ने। |
| Everyone in this room will see it. | यो कोठाका सबैले देख्नुहुन्छ। |
| Only {{player}} will see this message. | यो सन्देश {{player}} ले मात्र देख्नुहुन्छ। |
| Start the table conversation. | टेबलमा कुराकानी सुरु गर्ने। |
| Say something to get the table going. | केही रमाइलो कुरा लेखौँ। |
| Poke / Poke a player / Poke player | जिस्क्याउने / खेलाडीलाई जिस्क्याउने |
| Poke the table | टेबलमा जिस्क्याउने |
| Choose a player | खेलाडी छान्ने |
| Choose a reaction. Everyone at this table can see it. | प्रतिक्रिया छान्ने। टेबलका सबैले देख्नुहुन्छ। |
| Love | माया |
| Pinch | चिमोट्ने |
| Clap | ताली |
| Cheers | चियर्स |
| Laugh | हाँसो |
| Playful hammer | रमाइलो ठटाइ |
| Send {{reaction}} | {{reaction}} पठाउने |
| Poke {{player}} / Send poke to {{player}} | {{player}} लाई जिस्क्याउने |
| {{player}} sent you {{reaction}}! | {{player}} ले तपाईँलाई {{reaction}} पठाउनुभयो! |
| Poke sent | प्रतिक्रिया पठाइयो |
| Poke sent to {{player}} | {{player}} लाई प्रतिक्रिया पठाइयो |
| Sent to the table | टेबलमा पठाइयो |
| No other seated players to poke yet. | अहिले जिस्क्याउन अर्को खेलाडी सिटमा छैन। |
| JUST FOR YOU | तपाईँका लागि मात्र |
| TABLE TALK | टेबलको गफ |
| + Save phrase | + भनाइ सेभ गर्ने |
| My goofy phrases · {{count}} | मेरा रमाइला भनाइ · {{count}} |
| Save personal phrase | आफ्नो भनाइ सेभ गर्ने |
| Editing phrase | भनाइ सम्पादन गर्दै |
| Edit phrase {{phrase}} | भनाइ सम्पादन गर्ने: {{phrase}} |
| Remove punchline {{phrase}} | रमाइलो भनाइ हटाउने: {{phrase}} |
| Saved to your phrases. | तपाईँका भनाइमा सेभ भयो। |
| Your own little punchline… | आफ्नो रमाइलो भनाइ… |
| A keyword or punchline… | कुनै शब्द वा रमाइलो भनाइ… |
| Poke message, {{count}} characters maximum | जिस्क्याउने सन्देश, बढीमा {{count}} अक्षर |
| New personal phrase, {{count}} characters maximum | नयाँ भनाइ, बढीमा {{count}} अक्षर |
| {{saved}}/{{limit}} saved | {{limit}} मध्ये {{saved}} सेभ भएका |
| Your turn · Return to game | तपाईँको पालो · खेलमा फर्कने |

For reaction animations, use separate noun/action labels if needed: button **चिमोट्ने**, received notification **{{player}} ले तपाईँलाई चिमोट्नुभयो!**. Do not blindly interpolate every verb into “... पठाउनुभयो”. “Playful hammer” needs your tone preference; **रमाइलो ठटाइ** is only a draft.

## 21. Loading, connection, and short validation feedback

| English | Proposed Nepali |
| --- | --- |
| Reconnecting… | फेरि जोडिँदै… |
| Reconnecting to room... / Reconnecting to your room… | कोठामा फेरि जोडिँदै… |
| Reconnecting… Your seat is saved. | फेरि जोडिँदै… तपाईँको सिट सुरक्षित छ। |
| Reconnecting… send when you’re back. | फेरि जोडिँदै… जोडिएपछि पठाउने। |
| Updating game… | खेल अद्यावधिक हुँदैछ… |
| Game updated | खेल अद्यावधिक भयो |
| Sending your action… | तपाईँको चाल पठाउँदै… |
| Confirming your action… | तपाईँको चाल पुष्टि गर्दै… |
| Waiting for the server to confirm your action. | सर्भरबाट चालको पुष्टि पर्खँदै। |
| Connection interrupted. Retrying… | जडान टुट्यो। फेरि प्रयास हुँदैछ… |
| Check your connection and try again. | जडान जाँचेर फेरि प्रयास गर्ने। |
| Action rejected. / Social action rejected. | चाल स्वीकार भएन। / प्रतिक्रिया स्वीकार भएन। |
| Social request cancelled. | अनुरोध रद्द भयो। |
| Game request failed. Try again. | खेलको अनुरोध सफल भएन। फेरि प्रयास गर्ने। |
| Cannot load game. | खेल लोड गर्न सकिएन। |
| Cannot update game. / Could not update game. | खेल अद्यावधिक गर्न सकिएन। |
| Could not restore game. | खेलमा फर्कन सकिएन। |
| Could not create room. | कोठा बनाउन सकिएन। |
| Could not enter the room. / Could not join room. Try again. | कोठामा प्रवेश गर्न सकिएन। फेरि प्रयास गर्ने। |
| Could not enter this table. | यो टेबलमा प्रवेश गर्न सकिएन। |
| Could not enter the game’s room. Try again. | खेलको कोठामा जान सकिएन। फेरि प्रयास गर्ने। |
| Could not delete the room. | कोठा मेटाउन सकिएन। |
| Could not leave the room. | कोठा छोड्न सकिएन। |
| Could not leave the game. | खेल छोड्न सकिएन। |
| Could not leave the previous table. | अघिल्लो टेबल छोड्न सकिएन। |
| Could not confirm leaving this room. Please try again. | कोठा छोडेको पुष्टि भएन। फेरि प्रयास गर्ने। |
| Could not load member names. | सदस्यका नाम लोड हुन सकेनन्। |
| Could not open invitation. | निमन्त्रणा खोल्न सकिएन। |
| Could not search recent players. | हालैका खेलाडी खोज्न सकिएन। |
| Could not search the player directory. / Could not search players. | खेलाडी खोज्न सकिएन। |
| Could not load chat. / Could not load messages. | सन्देशहरू लोड हुन सकेनन्। |
| Could not load friends. | साथीहरूको सूची लोड हुन सकेन। |
| Could not send message. | सन्देश पठाउन सकिएन। |
| Could not send your poke. | प्रतिक्रिया पठाउन सकिएन। |
| Could not load punchlines. | रमाइला भनाइ लोड हुन सकेनन्। |
| Could not update punchlines. | रमाइला भनाइ अद्यावधिक हुन सकेनन्। |
| Could not update friendship. | साथीसम्बन्धी अनुरोध पूरा हुन सकेन। |
| Could not load notifications. | सूचनाहरू लोड हुन सकेनन्। |
| Could not update notifications. | सूचनाहरू अद्यावधिक हुन सकेनन्। |
| Could not update the request. | अनुरोध अद्यावधिक हुन सकेन। |
| Could not update the room invitation. | कोठाको निमन्त्रणा अद्यावधिक हुन सकेन। |
| Could not update the table invitation. | टेबलको निमन्त्रणा अद्यावधिक हुन सकेन। |
| Could not load ledger. | हिसाब लोड हुन सकेन। |
| Could not start settlement. | हिसाब मिलान सुरु गर्न सकिएन। |
| Could not update settlement. | हिसाब मिलान अद्यावधिक हुन सकेन। |
| Could not sign in. Please try again. | लगइन गर्न सकिएन। फेरि प्रयास गर्ने। |
| Could not share. Use the copy options above. | सेयर गर्न सकिएन। माथिको कपी विकल्प प्रयोग गर्ने। |
| Could not complete this request. Please try again. | अनुरोध पूरा हुन सकेन। फेरि प्रयास गर्ने। |
| The server could not complete this request. Please try again. | सर्भरले अनुरोध पूरा गर्न सकेन। फेरि प्रयास गर्ने। |
| The server returned an unexpected response. Please try again. | सर्भरबाट अपेक्षित जवाफ आएन। फेरि प्रयास गर्ने। |
| Enter a room name. | कोठाको नाम लेख्ने। |
| Enter a table name. | टेबलको नाम लेख्ने। |
| Enter a valid room code, table code, or invitation link. | सही कोठा/टेबल कोड वा निमन्त्रणा लिङ्क लेख्ने। |
| No players found. Use an exact username or user ID. | खेलाडी भेटिएन। सही प्रयोगकर्ता नाम वा ID राख्ने। |
| No player found with that exact name, username, or user ID. | त्यो नाम, प्रयोगकर्ता नाम वा ID भएको खेलाडी भेटिएन। |
| That table is full. Choose a table with an open seat. | टेबल भरिएको छ। खाली सिट भएको टेबल छान्ने। |
| This room is no longer available. Refresh the lobby. | यो कोठा अब उपलब्ध छैन। लबी ताजा गर्ने। |
| This game is no longer available. Ask for a new game link. | यो खेल अब उपलब्ध छैन। नयाँ खेलको लिङ्क माग्ने। |
| Sign in again before creating a table. | टेबल बनाउनुअघि फेरि लगइन गर्ने। |
| Sign in again to load tables. | टेबलहरू हेर्न फेरि लगइन गर्ने। |
| Reconnect before sending a poke. | प्रतिक्रिया पठाउनुअघि फेरि जोडिने। |
| Sign in before updating your phrases. | भनाइ बदल्नुअघि लगइन गर्ने। |
| Enter whole, nonnegative point amounts and counts. | अङ्क र सङ्ख्यामा शून्य वा धनात्मक पूर्णाङ्क लेख्ने। |
| Enter whole numbers from 0 to 1000. | ० देखि १००० सम्मका पूर्णाङ्क लेख्ने। |
| Link copied. Paste it into any messaging app. | लिङ्क कपी भयो। मेसेजिङ एपमा पेस्ट गर्न सक्नुहुन्छ। |
| Select and copy the link below. | तलको लिङ्क छानेर कपी गर्ने। |
| Unavailable | उपलब्ध छैन |

Server errors with technical details still need stable error-code mappings. The separate `server-copy.json` is a candidate inventory, not a suggestion to translate database errors verbatim. The displayed fallback should remain understandable and should not imply that an unconfirmed action definitely failed.

## 22. Close buttons and accessibility action families

These are repeated throughout the code. Give screen-reader labels the same wording as the visible action, with the affected section identified.

| English family | Proposed Nepali family |
| --- | --- |
| Close notifications | सूचना बन्द गर्ने |
| Close table menu / Close table menu backdrop | टेबल मेनु बन्द गर्ने |
| Close table themes / Close themes | थिम विकल्प बन्द गर्ने |
| Close table sharing / Close room sharing | टेबल सेयर विकल्प बन्द गर्ने / कोठा सेयर विकल्प बन्द गर्ने |
| Close public rooms | सार्वजनिक कोठाको सूची बन्द गर्ने |
| Close room form | कोठाको फारम बन्द गर्ने |
| Close room panel | कोठाको प्यानल बन्द गर्ने |
| Close rule review | नियम समीक्षा बन्द गर्ने |
| Close Call Break rules / Close Flush rules | कल ब्रेकका नियम बन्द गर्ने / फ्लसका नियम बन्द गर्ने |
| Close Bet | चालको विवरण बन्द गर्ने |
| Close final show | अन्तिम शो बन्द गर्ने |
| Close details / Close player details | विवरण बन्द गर्ने / खेलाडीको विवरण बन्द गर्ने |
| Close shown cards | देखाइएका तास बन्द गर्ने |
| Close finish tool | खेल टुङ्ग्याउने सहयोगी बन्द गर्ने |
| Close table announcement | टेबलको घोषणा बन्द गर्ने |
| Close chat / Close private chat / Close table chat | च्याट बन्द गर्ने / निजी च्याट बन्द गर्ने / टेबल च्याट बन्द गर्ने |
| Close poke composer / Close poke tools | जिस्क्याउने सन्देश बन्द गर्ने / प्रतिक्रिया विकल्प बन्द गर्ने |
| Dismiss social error | प्रतिक्रियासम्बन्धी त्रुटि हटाउने |
| Expand or minimize room chat | कोठाको च्याट ठूलो वा सानो गर्ने |
| Reveal next card from position {{position}} | स्थान {{position}} को अर्को तास खोल्ने |
| Turn this card face up without playing it | नखेलेकन यो तास खोल्ने |
| Copy {{copyNumber}} | प्रति {{copyNumber}} |
| Copy {{kind}} code | {{kind}} को कोड कपी गर्ने |

“Copy 2” on a physical Marriage card means **प्रति 2**. The action “Copy link” means **लिङ्क कपी गर्ने**. These must not share a single translation key.

## 23. Existing local-preview labels

These occur in design/demo screens, so keep them separate from live-game messages.

| English | Proposed Nepali |
| --- | --- |
| Game room preview | खेलको कोठाको नमुना |
| Preview a card table / Preview card table | तासको टेबलको नमुना हेर्ने |
| Create table preview | टेबलको नमुना बनाउने |
| Reset table preview | टेबलको नमुना फेरि सुरु गर्ने |
| Preview paused | नमुना रोकिएको |
| Card placed · preview paused | तास राखियो · नमुना रोकिएको |
| Place selected card | छानिएको तास राख्ने |
| Place {{card}} on the table | {{card}} टेबलमा राख्ने |
| Select a card to place | राख्ने तास छान्ने |
| SAMPLE TABLES | नमुना टेबलहरू |
| WAITING ROOM PREVIEW | खेल पर्खने कोठाको नमुना |
| Exit preview | नमुनाबाट बाहिरिने |
| Go to room list to enter a code | कोड राख्न कोठाको सूचीमा जाने |
| {{count}} players · 5 deals · Local preview | {{count}} खेलाडी · ५ डिल · स्थानीय नमुना |

## 24. Remaining short headings, prompts, and dynamic summaries

In the raw extraction, placeholders are named `value1`, `value2`, and so on. This review gives them meaningful names such as `player`, `count`, and `card`; their original source expressions are recorded in `ui-copy.json`. These are planning names, not implemented key changes.

| English | Proposed Nepali |
| --- | --- |
| Bidding begins when everyone accepts. | सबैले हात स्वीकार गरेपछि बोली सुरु हुन्छ। |
| Cut in half or skip the cut. | बीचबाट काट्ने वा नकाट्ने। |
| Final scores after five deals. | पाँच डिलपछिका अन्तिम अङ्कहरू। |
| Review the scores before the next deal. | अर्को डिलअघि अङ्कहरू हेर्ने। |
| Review your cards while the remaining players bid. | अरूको बोली लाग्दै गर्दा आफ्नो तास हेर्ने। |
| Swipe your hand to see every card. | सबै तास हेर्न हातको तास सार्ने। |
| The dealer shuffles to begin this deal. | डिल सुरु गर्न बाँड्ने खेलाडीले तास फिट्ने। |
| Waiting for the table. | टेबल तयार हुन पर्खँदै। |
| Your bid is submitted only when you confirm. | पक्का गरेपछि मात्र तपाईँको बोली दर्ता हुन्छ। |
| Your hand in dealt order | बाँडिएको क्रममै तपाईँको तास |
| Your hand, grouped by suit: {{suits}} | रङअनुसार मिलाइएको तपाईँको तास: {{suits}} |
| Blind {{blindAmount}} · Seen {{seenAmount}} | ब्लाइन्ड {{blindAmount}} · हेरेपछि {{seenAmount}} |
| Show: {{status}} | शो: {{status}} |
| Propose these changes for approval before starting. | सुरु गर्नुअघि यी परिवर्तन स्वीकृतिका लागि प्रस्ताव गर्ने। |
| Save or reload rule changes first. | पहिले नियमका परिवर्तन सेभ वा फेरि लोड गर्ने। |
| Saved rules changed. Reload before editing or starting. | सेभ भएका नियम फेरिए। सम्पादन वा सुरु गर्नुअघि फेरि लोड गर्ने। |
| Deal and turns | तास बाँड्ने र पालो |
| Points and privacy | अङ्क र गोपनीयता |
| Showing or discarding | तास देखाउने वा फाल्ने |
| Tiplu, Jhiplu, Poplu and Alter | टिप्लु, झिप्लु, पोप्लु र अल्टर |
| Tiplu {{tiplu}} · Jhiplu {{jhiplu}} · Poplu {{poplu}} | टिप्लु {{tiplu}} · झिप्लु {{jhiplu}} · पोप्लु {{poplu}} |
| Man · {{copyNumber}} | मान · {{copyNumber}} |
| 3 sequences / Tunnelas ({{options}}) | ३ सिक्वेन्स / टनेला ({{options}}) |
| 7 Dublees ({{options}}) | ७ डुप्ली ({{options}}) |
| Waiting for the creator to start. | आयोजकले सुरु गर्न पर्खँदै। |
| Waiting for the creator to start the next deal. | आयोजकले अर्को डिल सुरु गर्न पर्खँदै। |
| Waiting for eligible seats and rule approval. | योग्य खेलाडी र नियम स्वीकृति पर्खँदै। |
| Everyone is ready · the creator can start | सबै तयार · आयोजकले सुरु गर्न सक्नुहुन्छ |
| Waiting for the host · {{seated}}/{{capacity}} seated | आयोजकलाई पर्खँदै · {{seated}}/{{capacity}} सिट भरिएका |
| 4 or 5 players · Five deals | ४ वा ५ खेलाडी · पाँच डिल |
| A quick refresher | छोटो सम्झना |
| New to Call Break? | कल ब्रेकमा नयाँ हुनुहुन्छ? |
| Open a room or bring your players together. | कोठा खोल्ने वा साथीहरूलाई एकै ठाउँमा बोलाउने। |
| Bring your people together for another round. | अर्को राउन्डका लागि साथीहरूलाई बोलाऔँ। |
| A little suspense. A familiar circle of friends. | अलिकति कौतुहल। आफ्नै साथीहरूको जमघट। |
| Good cards. Better company. | तासको मजा। साथीहरूको साथ। |
| The table is taking shape. | टेबलमा खेलाडी जुट्दैछन्। |
| There’s always room for one more round. | अर्को राउन्ड खेल्न अझै मौका छ। |
| Choose {{game}} | {{game}} छान्ने |
| Join {{tableName}} | {{tableName}} मा सहभागी हुने |
| Leave {{gameOrTable}} | {{gameOrTable}} छोड्ने |
| Share {{name}} | {{name}} सेयर गर्ने |
| Shareable table code {{code}} | सेयर गर्न मिल्ने टेबल कोड {{code}} |
| Showing the last available tables. Try refreshing again. | पछिल्लो उपलब्ध टेबल सूची देखाइएको छ। फेरि ताजा गर्ने। |
| This round has no scoring breakdown available. | यस राउन्डको अङ्कको विस्तृत हिसाब उपलब्ध छैन। |
| Accepting adds this room to your memberships. | स्वीकार गरेपछि यो कोठाको सदस्य बन्नुहुन्छ। |
| Current deal · newest first | अहिलेको डिल · नयाँ पहिले |
| Recent server events · newest first | सर्भरका पछिल्ला गतिविधि · नयाँ पहिले |
| Revision {{number}} | अद्यावधिक क्रम {{number}} |
| Game complete · see the final scores | खेल सकियो · अन्तिम अङ्क हेर्ने |
| Join my Bhidne Ho table | मेरो भिड्ने हो टेबलमा आउनुहोस् |
| Offline · {{player}} | अफलाइन · {{player}} |
| Need {{count}} | {{count}} चाहिने |
| Won {{count}} | जितेका {{count}} |
| {{player}} played {{card}} | {{player}} ले {{card}} खेल्नुभयो |
| {{player}}, deal {{deal}}, bid {{bid}}, won {{tricks}} | {{player}}, डिल {{deal}}, बोली {{bid}}, जितेका बाजी {{tricks}} |
| {{game}} · {{phase}} · {{seated}}/{{capacity}} players | {{game}} · {{phase}} · {{seated}}/{{capacity}} खेलाडी |
| {{count}} waiting | {{count}} जना पर्खँदै |
| {{game}} table | {{game}} को टेबल |
| {{game}} code {{code}} | {{game}} को कोड {{code}} |
| {{player}} proposed rule changes · Review | {{player}} ले नियम परिवर्तन प्रस्ताव गर्नुभयो · हेर्ने |
| {{player}} place → 1st: {{amount}} units | {{player}} को स्थान → पहिलो स्थान: {{amount}} एकाइ |
| Session expired. The server may have restarted. Sign out to start a new session. | सत्र सकियो। सर्भर पुनः सुरु भएको हुन सक्छ। लगआउट गरेर फेरि लगइन गर्ने। |
| Browser session storage is unavailable. Enable it to sign in. | ब्राउजरको सत्र भण्डारण उपलब्ध छैन। लगइन गर्न यसलाई खुला गर्ने। |
| Could not confirm delivery. Check the conversation before sending again. | सन्देश पुगेको पुष्टि भएन। फेरि पठाउनुअघि कुराकानी हेर्ने। |
| The game changed. Your pending action was not retried. | खेल फेरियो। बाँकी रहेको चाल फेरि पठाइएन। |
| Connection interrupted. Your action will be checked automatically… | जडान टुट्यो। तपाईँको चालको अवस्था आफैँ जाँचिनेछ… |
| Waiting for the table service. Your form will stay open while it retries. | टेबल सेवा पर्खँदै। फेरि प्रयास हुँदा फारम खुलै रहन्छ। |

Comma-separated accessibility fragments such as “you”, “dealer”, “current turn”, “disconnected”, and “winner” use the approved labels above, but the final spoken sentence should be assembled in Nepali order. Arrow and sparkle decorations remain visual symbols. Bare counters, card notation, `@username`, and name-only expressions are not separate translation sentences.

## Review priorities

1. Approve the card vocabulary: **बाजी**, **डिल**, Flush **चाल**, **डुप्ली**, **टनेला**, and **मान**.
2. Approve whether the UI should say **कोठा** or **रुम**, and **जिस्क्याउने** or **पोक**.
3. Approve short **गर्ने** button phrasing versus formal **गर्नुहोस्**.
4. Review each dynamic sentence as a whole. Keep names and numbers as placeholders; translate nested action/status labels before insertion.
5. Keep theme and language separate. After wording approval, plan runtime keys, plural handling, accessibility labels, and mobile-width checks. This document itself changes none of those.
