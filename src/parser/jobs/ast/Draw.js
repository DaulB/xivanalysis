import React from 'react'
import {Trans, i18nMark, Plural} from '@lingui/react'

import ACTIONS from 'data/ACTIONS'
import Module from 'parser/core/Module'
import {ActionLink} from 'components/ui/DbLink'
import {DRAWN_CARD_USE} from './ArcanaGroups'
import {TieredRule, Requirement, TARGET} from 'parser/core/modules/Checklist'
import {TieredSuggestion, SEVERITY} from 'parser/core/modules/Suggestions'

// Time allowed to hold every time action occures (not sure if we want to implement this/what times to put)
const EXCUSED_CARD_HOLD_DEFAULT = 1500
const EXCUSED_DRAW_HOLD_DEFAULT = 1500
const EXCUSED_SLEEVE_OVERWRITE_DEFAULT = 1500

const DRAW_MISSED_MAX_WARN = 1

const CARD_LOSS_SEVERITY = {
	1: SEVERITY.MEDIUM,
	2: SEVERITY.MAJOR,
}

// TODO: Check that there is not already an aoe card in effect before casting another AOE card
export default class Draw extends Module {
	static handle = 'draw'
	static i18n_id = i18nMark('ast.draw.title')
	static dependencies = [
		'cooldowns',
		'unableToAct',
		'checklist',
		'suggestions',
	]

	_lastUseCard = 0
	_lastUseDraw = 0
	_lastUseSleeveDraw = 0
	_usesDraw = 0
	_totalHeldCard = 0
	_totalHeldDraw = 0
	_excusedHeldCard = 0
	_excusedHeldDraw = 0
	_drawTimeLossFromSleeve = 0
	_excusedDrawTimeLossFromSleeve = 0

	constructor(...args) {
		super(...args)

		const drawnCardFilter = {
			by: 'player',
			abilityId: DRAWN_CARD_USE.concat([ACTIONS.ROYAL_ROAD.id, ACTIONS.SPREAD.id, ACTIONS.MINOR_ARCANA.id]),
		}

		const drawFilter = {
			by: 'player',
			abilityId: ACTIONS.DRAW.id,
		}

		const sleeveDrawFilter = {
			by: 'player',
			abilityId: ACTIONS.SLEEVE_DRAW.id,
		}

		this.addHook('cast', drawnCardFilter, this._onDrawnCardUse)
		this.addHook('cast', drawFilter, this._onDrawUse)
		this.addHook('cast', sleeveDrawFilter, this._onSleeveDrawUse)
		this.addHook('complete', this._onComplete)
	}

	_onSleeveDrawUse(event) {
		this._lastUseSleeveDraw = event.timestamp
		this._drawTimeLossFromSleeve += ACTIONS.DRAW.cooldown*1000 - this.cooldowns.getCooldownRemaining(ACTIONS.DRAW.id)
		this._excusedDrawTimeLossFromSleeve += EXCUSED_SLEEVE_OVERWRITE_DEFAULT
	}

	_onDrawnCardUse(event) {

		if (this._lastUseCard === 0) {
			this._lastUseCard = this.parser.fight.start_time
		}
		if (this._lastUseDraw === 0) {
			this._lastUseDraw = this.parser.fight.start_time
		}

		const firstOpportunity = Math.max(this._lastUseDraw, this._lastUseSleeveDraw)
		const _held = event.timestamp - firstOpportunity
		if (_held > 0) {
			const downtimes = this.unableToAct.getDowntimes(firstOpportunity, firstOpportunity + EXCUSED_CARD_HOLD_DEFAULT)
			const firstEnd = downtimes.length ? downtimes[0].end : firstOpportunity
			this._totalHeldCard += _held
			this._excusedHeldCard += EXCUSED_CARD_HOLD_DEFAULT + (firstEnd - firstOpportunity)
		}

		this._lastUseCard = event.timestamp

		this.cooldowns.startCooldown(ACTIONS.DRAW.id)
	}

	_onDrawUse(event) {
		this._usesDraw++

		if (this._lastUseCard === 0) {
			this._lastUseCard = this.parser.fight.start_time
		}
		if (this._lastUseDraw === 0) {
			this._lastUseDraw = this.parser.fight.start_time
		}

		const firstOpportunity = this._lastUseCard + ACTIONS.DRAW.cooldown*1000
		const _held = event.timestamp - firstOpportunity
		if (_held > 0) {
			const downtimes = this.unableToAct.getDowntimes(firstOpportunity, firstOpportunity + EXCUSED_DRAW_HOLD_DEFAULT)
			const firstEnd = downtimes.length ? downtimes[0].end : firstOpportunity
			this._totalHeldDraw += _held
			this._excusedHeldDraw += EXCUSED_DRAW_HOLD_DEFAULT + (firstEnd - firstOpportunity)
		}

		this._lastUseDraw = event.timestamp
	}

	_onComplete() {
		const drawHoldDuration = this._usesDraw === 0 ? this.parser.fightDuration : this._totalHeldDraw
		const cardHoldDuration = this._usesDraw === 0 ? this.parser.fightDuration : this._totalHeldCard
		const sleeveHoldDuration = this._drawTimeLossFromSleeve

		console.log(this._excusedHeldCard)

		const _drawUsesMissedFromCards = ((cardHoldDuration - this._excusedHeldCard) / (ACTIONS.DRAW.cooldown * 1000))
		const _drawUsesMissedFromDrift = ((drawHoldDuration - this._excusedHeldDraw) / (ACTIONS.DRAW.cooldown * 1000))
		const _drawUsesMissedFromSleeve = ((sleeveHoldDuration - this._excusedDrawTimeLossFromSleeve) / (ACTIONS.DRAW.cooldown * 1000))

		const drawUsesMissedFromCards = Math.floor(_drawUsesMissedFromCards)
		const drawUsesMissedFromDrift = Math.floor(_drawUsesMissedFromDrift)
		const drawUsesMissedFromSleeve = Math.floor(_drawUsesMissedFromSleeve)

		const _totalDrawUsesMissed = Math.floor(_drawUsesMissedFromCards + _drawUsesMissedFromDrift + _drawUsesMissedFromSleeve)
		const maxDrawUses = this._usesDraw + _totalDrawUsesMissed

		const drawWarnTarget = 100 * (maxDrawUses - DRAW_MISSED_MAX_WARN) / maxDrawUses

		this.checklist.add(new TieredRule({
			name: <Trans id="ast.draw.checklist.name">
				Use Draw Frequently
			</Trans>,
			description: <Trans id="ast.draw.checklist.description">
				<ActionLink {...ACTIONS.DRAW} /> is the main mechanic of the astrologians,
				so we want to use it as much as possible.
			</Trans>,
			tiers: {[drawWarnTarget]: TARGET.WARN, [drawWarnTarget-1]: TARGET.FAIL, [drawWarnTarget+1]: TARGET.SUCCESS},
			requirements: [
				new Requirement({
					name: <Trans id="ast.draw.checklist.requirement.name">
						<ActionLink {...ACTIONS.DRAW} /> uses
					</Trans>,
					value: this._usesDraw,
					target: Math.max(maxDrawUses, this._usesDraw, 1),
				}),
			],
		}))

		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.DRAW.icon,
			content: <Trans id="ast.draw.suggestions.draw.content">
				<ActionLink {...ACTIONS.DRAW} /> is the main mechanic of the astrologian,
					so make sure to use it as much as possible.
			</Trans>,
			why: <Trans id="ast.draw.suggestions.draw.why">
				<Plural value={drawUsesMissedFromDrift} one="# cast" other="# casts" />
					of Draw missed. ({this.parser.formatDuration(drawHoldDuration - this._excusedHeldDraw)} drift)
			</Trans>,
			tiers: CARD_LOSS_SEVERITY,
			value: drawUsesMissedFromDrift,
		}))

		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.THE_BALANCE.icon,
			content: <Trans id="ast.draw.suggestions.cards.content">
					It is almost never worth it to hold onto cards for too long.
					Doing so will delay your next card draw and may even make you lose Draws over the duration of the fight.
					Always try to use your cards as fast as possible.
			</Trans>,
			why: <Trans id="ast.draw.suggestions.cards.why">
				<Plural value={drawUsesMissedFromCards} one="# cast" other="# casts" />
					of Draw missed from holding onto cards for too long.
					(Held onto cards for a total duration of {this.parser.formatDuration(cardHoldDuration - this._excusedHeldCard)})
			</Trans>,
			tiers: CARD_LOSS_SEVERITY,
			value: drawUsesMissedFromCards,
		}))

		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.SLEEVE_DRAW.icon,
			content: <Trans id="ast.sleeve-draw.suggestions.draw.content">
					Using <ActionLink {...ACTIONS.SLEEVE_DRAW} /> restarts the cooldown on <ActionLink {...ACTIONS.DRAW} />,
					so you want to always use Sleeve Draw right after using Draw in order to get as many cards in as possible.
			</Trans>,
			why: <Trans id="ast.sleeve-draw.suggestions.draw.why">
				<Plural value={drawUsesMissedFromSleeve} one="# use" other="# uses" />
					of Draw missed because Sleeve Draw was used when Draw was almost ready to be used.
					({this.parser.formatDuration(sleeveHoldDuration - this._excusedDrawTimeLossFromSleeve)} lost).
			</Trans>,
			tiers: CARD_LOSS_SEVERITY,
			value: drawUsesMissedFromSleeve,
		}))
	}
}
