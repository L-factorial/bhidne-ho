"""Required-action detection from existing server-authorized player projections."""
import hashlib
import json

TEXT = {
 'en': {'title':'Bhidne Ho','bid':'Your turn to bid','play':'Your turn — play a card',
  'shuffle':'Your turn — shuffle the deck','cut':'Your turn — cut the deck','deal':'Your turn — deal the cards',
  'draw':'Your turn — draw a card','discard':'Your turn — discard a card','finish':'Your turn — finish your hand',
  'declare':'Declare your initial Tunnelas','bet':'Your turn — choose your bet',
  'side_show':'A side-show needs your response','review':'Review and accept your hand',
  'ready':'Your game is ready to start','game_invitation':'You have a game invitation',
  'room_invitation':'You have a room invitation','chat':'You have a new chat message','poke':'A player poked you'},
 'ne': {'title':'भिड्ने हो','bid':'बोली लगाउने तपाईंको पालो','play':'तपाईंको पालो — तास खेल्नुहोस्',
  'shuffle':'तपाईंको पालो — तास फिट्नुहोस्','cut':'तपाईंको पालो — तास काट्नुहोस्','deal':'तपाईंको पालो — तास बाँड्नुहोस्',
  'draw':'तपाईंको पालो — तास तान्नुहोस्','discard':'तपाईंको पालो — तास फाल्नुहोस्','finish':'तपाईंको पालो — हात पूरा गर्नुहोस्',
  'declare':'सुरुका टनेला घोषणा गर्नुहोस्','bet':'तपाईंको पालो — बाजी रोज्नुहोस्',
  'side_show':'साइड शोको जवाफ दिनुहोस्','review':'आफ्नो हात जाँचेर स्वीकार गर्नुहोस्',
  'ready':'खेल सुरु गर्न तयार छ','game_invitation':'तपाईंलाई खेलको निमन्त्रणा आएको छ',
  'room_invitation':'तपाईंलाई कोठाको निमन्त्रणा आएको छ','chat':'तपाईंलाई नयाँ च्याट सन्देश आएको छ','poke':'एक खेलाडीले तपाईंलाई पोक गरेका छन्'},
}

def action(view):
    if not view.get('your_player_id') or view.get('status') in ('ended','finished'):return None
    mine = view['your_player_id']; kind = None; evidence = None
    if view.get('status')=='waiting':
        if view.get('ready'):kind,evidence='ready',True
    elif view.get('game_type')=='marriage':
        state=view.get('marriage') or {}; private=state.get('private') or {}; public=state.get('public') or {}
        own=next((p for p in public.get('players',[]) if p['player_id']==str(mine)),{})
        kinds=private.get('actions',{}).get('kinds',[])
        if own.get('folded'):return None
        if 'declare_tunnelas' in kinds:
            kind='declare';evidence=public.get('declaration_phase_id') or 'initial'
        elif public.get('current_player_id')==str(mine):
            kind=next((k for k in ('draw','discard','finish') if k in kinds),None)
            evidence=[public.get('phase'),public.get('stock_count'),public.get('top_discard'),
                      private.get('hand'),(state.get('moves') or [{}])[-1].get('sequence')]
    elif view.get('game_type')=='flush':
        state=view.get('flush') or {}; public=state.get('public') or {}; private=state.get('private') or {}
        kinds=private.get('actions',{}).get('kinds',[])
        if public.get('settlement'):return None
        pending=public.get('pending_side_show') or {}
        if pending.get('target_id')==str(mine) and any(k in kinds for k in ('accept_side_show','decline_side_show')):
            kind='side_show';evidence=pending
        elif public.get('current_player_id')==str(mine) and kinds:
            kind='bet';evidence=[public.get('round_number'),public.get('pot'),state.get('bets',[])]
    else:
        game=view.get('game') or {}; private=view.get('private') or {}
        if private.get('can_accept_hand'):
            kind='review';evidence=[game.get('deal_number'),view.get('deal'),private.get('hand')]
        elif game.get('turn',{}).get('player_id')==mine:
            kind={'BIDDING':'bid','PLAYING':'play','AWAITING_SHUFFLE':'shuffle','AWAITING_CUT':'cut','AWAITING_DISTRIBUTION':'deal'}.get(game.get('phase'))
            # Exclude wall-clock countdowns and global snapshot revisions.
            evidence=[game.get('deal_number'),view.get('deal'),game.get('current_trick'),private.get('hand'),game.get('phase')]
    if kind is None:return None
    encoded=json.dumps([view['match_id'],mine,kind,evidence],sort_keys=True,separators=(',',':'))
    return kind,hashlib.sha256(encoded.encode()).hexdigest()


def message(kind,locale,data):
    text=TEXT.get(locale,TEXT['en'])
    return dict(title=text['title'],body=text[kind],data=data)
