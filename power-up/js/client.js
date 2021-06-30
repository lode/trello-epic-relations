/* global TrelloPowerUp */

var Promise = TrelloPowerUp.Promise;

const CDN_BASE_URL = document.getElementById('js-cdn-base-url').href;
const ICON_UP      = CDN_BASE_URL + 'icon-up.png';
const ICON_DOWN    = CDN_BASE_URL + 'icon-down.png';
const LIST_MAXIMUM = 10;

/**
 * @param  {object} t context
 * @param  {string} parentAttachmentId
 * @return {string} shortLink
 */
function getParentShortLinkByAttachmentId(t, parentAttachmentId) {
	return t.card('attachments').then(async function(card) {
		const parentAttachment = card.attachments.find(function(attachment) {
			return (attachment.id === parentAttachmentId);
		});
		
		// if the attachment was removed manually
		if (parentAttachment === undefined) {
			return undefined;
		}
		
		const parentCardShortLink = getCardShortLinkFromUrl(parentAttachment.url);
		
		return parentCardShortLink;
	});
}

/**
 * @param  {object} t without context
 * @param  {string} childCardIdOrShortLink
 * @return {string} attachmentId
 */
async function getParentAttachmentIdOfRelatedChild(t, childCardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + childCardIdOrShortLink + '/pluginData', {}, null, function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
		
		const parentPluginData = response.find(function(pluginData) {
			return (JSON.parse(pluginData.value).parentAttachmentId !== undefined);
		});
		
		const parentAttachmentId = (parentPluginData !== undefined) ? JSON.parse(parentPluginData.value).parentAttachmentId : undefined;
		
		return parentAttachmentId;
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t without context
 * @param  {string} parentCardIdOrShortLink
 * @return {string} checklistId
 */
async function getChildrenChecklistIdOfRelatedParent(t, parentCardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + parentCardIdOrShortLink + '/pluginData', {}, null, function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
		
		const childPluginData = response.find(function(pluginData) {
			return (JSON.parse(pluginData.value).childrenChecklistId !== undefined);
		});
		
		const childrenChecklistId = (childPluginData !== undefined) ? JSON.parse(childPluginData.value).childrenChecklistId : undefined;
		
		return childrenChecklistId;
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t without context
 * @param  {string} childrenChecklistId
 * @return {Promise}
 */
function getCheckItemsFromRelatedParent(t, childrenChecklistId) {
	try {
		return window.Trello.get('checklists/' + childrenChecklistId + '/checkItems?fields=name,state', {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {string} cardUrl
 * @return {string} shortLink
 */
function getCardShortLinkFromUrl(cardUrl) {
	const matches = cardUrl.match(/^https:\/\/trello\.com\/c\/([^/]+)(\/|$)/);
	if (matches === null) {
		return undefined;
	}
	
	const shortLink = matches[1];
	
	return shortLink;
}

/**
 * @param  {object} t without context
 * @param  {string} cardIdOrShortLink
 * @return {object} card {
 *         @var {string} id
 *         @var {string} name
 *         @var {string} url
 * }
 */
async function getCardByIdOrShortLink(t, cardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + cardIdOrShortLink + '?fields=id,name,url', {}, function(response) {
			return response;
		},
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
		
		return {
			id:   response.id,
			name: response.name,
			url:  response.url,
		};
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object}   t             context
 * @param  {object}   options       from context, containing optional search keyword
 * @param  {string}   parentOrChild one of 'parent' or 'child'
 * @param  {Function} callback      to execute when choosing a certain card
 * @return {array}                  cards with {
 *         @var {string}   text
 *         @var {Function} callback
 * }
 */
async function searchCards(t, options, parentOrChild, callback) {
	const searchTerm = options.search;
	
	// collect current parent
	let parentCardShortLink = undefined;
	await t.get('card', 'shared', 'parentAttachmentId').then(async function(parentAttachmentId) {
		if (parentAttachmentId !== undefined) {
			parentCardShortLink = await getParentShortLinkByAttachmentId(t, parentAttachmentId);
		}
	});
	
	// get current children
	const childCardShortLinks = await t.get('card', 'shared', 'childrenShortLinks');
	
	// offer to add by card link
	if (searchTerm !== '' && searchTerm.indexOf('https://trello.com/c/') === 0) {
		return t.cards('id', 'name', 'url', 'shortLink').then(async function(cards) {
			const searchShortLink = getCardShortLinkFromUrl(searchTerm);
			
			// skip already added cards
			if (parentCardShortLink !== undefined && parentCardShortLink === searchShortLink) {
				return [];
			}
			if (childCardShortLinks !== undefined && childCardShortLinks.includes(searchShortLink)) {
				return [];
			}
			
			// try to find the title of the linked card
			let matchingCard = cards.find(function(card) {
				return (card.shortLink === searchShortLink);
			});
			
			// skip self
			if (matchingCard !== undefined && matchingCard.id === t.getContext().card) {
				return [];
			}
			
			// get the card from another board
			if (matchingCard === undefined) {
				matchingCard = await getCardByIdOrShortLink(t, searchShortLink);
			}
			
			return [
				{
					text: matchingCard.name,
					callback: function(t, options) {
						callback(t, matchingCard);
					},
				},
			];
		});
	}
	else {
		return t.cards('id', 'name', 'url', 'shortLink', 'dateLastActivity').then(async function(cards) {
			// skip self and already added cards
			cards = cards.filter(function(card) {
				if (t.getContext().card === card.id) {
					return false;
				}
				if (parentCardShortLink !== undefined && parentCardShortLink === card.shortLink) {
					return false;
				}
				if (childCardShortLinks !== undefined && childCardShortLinks.includes(card.shortLink)) {
					return false;
				}
				
				return true;
			});
			
			// filter by search term
			if (searchTerm !== '') {
				cards = cards.filter(function(card) {
					return (card.name.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1);
				});
			}
			
			// favor most recent touched cards
			cards.sort(function(cardA, cardB) {
				return (cardA.dateLastActivity < cardB.dateLastActivity) ? 1 : -1;
			});
			
			// don't process too much
			cards = cards.slice(0, LIST_MAXIMUM);
			
			// create list items
			cards = cards.map(function(card) {
				return {
					text: card.name,
					callback: function(t, options) {
						callback(t, card);
					},
				};
			});
			
			// add remove buttons
			if (searchTerm === '') {
				if (parentOrChild === 'parent') {
					await t.get('card', 'shared', 'parentAttachmentId').then(function(parentAttachmentId) {
						if (parentAttachmentId !== undefined) {
							cards.push({
								text:     '× Remove current EPIC',
								callback: function(t, options) {
									removeParentFromContext(t, parentAttachmentId);
									t.closePopup();
								},
							});
						}
					});
				}
				
				if (parentOrChild === 'child') {
					await t.get('card', 'shared', 'childrenChecklistId').then(function(childrenChecklistId) {
						if (childrenChecklistId !== undefined) {
							cards.push({
								text:     '× Remove all tasks (remove the EPIC from the task card to remove a single task)',
								callback: function(t, options) {
									removeChildrenFromContext(t);
									t.closePopup();
								},
							});
						}
					});
				}
			}
			
			return cards;
		});
	}
}

/**
 * add parent to a card
 * 
 * @param {object} t context
 * @param {object} parentCard {
 *        @var {string} id
 *        @var {string} name
 *        @var {string} url
 * }
 */
function addParentToContext(t, parentCard) {
	t.get('card', 'shared', 'parentAttachmentId').then(async function(parentAttachmentId) {
		if (parentAttachmentId !== undefined) {
			removeParentFromContext(t, parentAttachmentId);
		}
		
		addParentAttachment(t, parentCard, t.getContext().card).then(async function(attachment) {
			t.set('card', 'shared', 'parentAttachmentId', attachment.id);
			const childCard = await t.card('id', 'name', 'url');
			const parentCardId = parentCard.id;
			addChildToRelatedParent(t, childCard, parentCardId);
		});
	});
}

/**
 * sync so child get context as parent
 * 
 * @param {object} t without context
 * @param {object} parentCard {
 *        @var {string} name
 *        @var {string} url
 * }
 * @param {string} childCardId
 */
async function addParentToRelatedChild(t, parentCard, childCardId) {
	const childCardIdOrShortLink = childCardId;
	const parentAttachmentId = await getParentAttachmentIdOfRelatedChild(t, childCardIdOrShortLink);
	if (parentAttachmentId !== undefined) {
		t.alert({
			message: 'That task is already part of another EPIC. Change the EPIC on that card to switch.',
		});
	}
	else {
		addParentAttachment(t, parentCard, childCardIdOrShortLink).then(function(attachment) {
			t.set('organization', 'shared', 'parentAttachmentId-' + childCardId, attachment.id);
		});
	}
}

/**
 * add parent
 * attach via Rest API instead of t.attach() to get attachment id
 * 
 * @param {object} t without context
 * @param {object} parentCard {
 *        @var {string} name
 *        @var {string} url
 * }
 * @param {string} childCardIdOrShortLink
 * @return {Promise}
 */
function addParentAttachment(t, parentCard, childCardIdOrShortLink) {
	const postData = {
		name: 'EPIC: ' + parentCard.name,
		url:  parentCard.url,
	};
	
	try {
		return window.Trello.post('cards/' + childCardIdOrShortLink + '/attachments', postData, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * remove parent from a card
 * 
 * @param  {object} t context
 * @param  {string} parentAttachmentId
 */
async function removeParentFromContext(t, parentAttachmentId) {
	await t.remove('card', 'shared', 'parentAttachmentId');
	
	t.card('shortLink', 'attachments').then(async function(card) {
		const parentAttachment = card.attachments.find(function(attachment) {
			return (attachment.id === parentAttachmentId);
		});
		
		const childCardIdOrShortLink = t.getContext().card;
		removeParentAttachment(t, childCardIdOrShortLink, parentAttachmentId);
		
		const parentCardShortLink = getCardShortLinkFromUrl(parentAttachment.url);
		const parentCard          = await getCardByIdOrShortLink(t, parentCardShortLink);
		let childrenChecklistId   = await getChildrenChecklistIdOfRelatedParent(t, parentCardShortLink);
		
		// parent is on another board, and the plugindata isn't connected yet
		// get checklist from organization level plugindata instead
		if (childrenChecklistId === undefined) {
			childrenChecklistId = await t.get('organization', 'shared', 'childrenChecklistId-' + parentCard.id);
		}
		
		const checkItems = await getCheckItemsFromRelatedParent(t, childrenChecklistId);
		
		const childCheckItem = checkItems.find(function(checkItem) {
			let childCheckItemShortLink = getCardShortLinkFromUrl(checkItem.name);
			return (childCheckItemShortLink === card.shortLink);
		});
		
		removeChildCheckItem(t, childrenChecklistId, childCheckItem.id).then(function() {
			markToRecacheOnRelatedParent(t, parentCard.id);
		});
	});
}

/**
 * @param  {object} t without context
 * @param  {string} childCardId
 * @param  {string} parentAttachmentId
 */
function removeParentFromRelatedChild(t, childCardId, parentAttachmentId) {
	t.set('organization', 'shared', 'parentAttachmentId-' + childCardId, 'remove').then(function() {
		const childCardIdOrShortLink = childCardId;
		removeParentAttachment(t, childCardIdOrShortLink, parentAttachmentId);
	});
}

/**
 * @param  {object} t without context
 * @param  {string} childCardIdOrShortLink
 * @param  {string} parentAttachmentId
 * @return {Promise}
 */
function removeParentAttachment(t, childCardIdOrShortLink, parentAttachmentId) {
	try {
		return window.Trello.delete('cards/' + childCardIdOrShortLink + '/attachments/' + parentAttachmentId, {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param {object} t context
 * @param {object} childCard {
 *        @var {string} id
 *        @var {string} shortLink
 *        @var {string} url
 * }
 */
async function addChildToContext(t, childCard) {
	const childCardIdOrShortLink = childCard.id;
	const parentAttachmentId = await getParentAttachmentIdOfRelatedChild(t, childCardIdOrShortLink);
	if (parentAttachmentId !== undefined) {
		t.alert({
			message: 'That task is already part of another EPIC. Change the EPIC on that card to switch.',
		});
		return;
	}
	
	// already set the new shortlink in the cache
	// this will be done further down via the recache as well
	// but that is not fast enough to notice when opening the search directly
	t.get('card', 'shared', 'childrenShortLinks').then(function(childrenShortLinks) {
		if (childrenShortLinks === undefined) {
			childrenShortLinks = [];
		}
		
		childrenShortLinks.push(childCard.shortLink);
		
		t.set('card', 'shared', 'childrenShortLinks', childrenShortLinks);
	})
	
	t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			const parentCardIdOrShortLink = t.getContext().card;
			const response = await addChildrenChecklist(t, parentCardIdOrShortLink);
			childrenChecklistId = response.id;
			t.set('card', 'shared', 'childrenChecklistId', childrenChecklistId);
		}
		
		addChildCheckItem(t, childCard, childrenChecklistId).then(async function(response) {
			recacheChildrenByContext(t);
			
			const parentCard  = await t.card('id', 'name', 'url');
			const childCardId = childCard.id;
			addParentToRelatedChild(t, parentCard, childCardId);
		});
	});
}

/**
 * sync so parent gets context as child
 * 
 * @param {object} t without context
 * @param {object} childCard {
 *        @var {string} url
 * }
 * @param {object} parentCardId
 */
async function addChildToRelatedParent(t, childCard, parentCardId) {
	const parentCardIdOrShortLink = parentCardId;
	let childrenChecklistId = await getChildrenChecklistIdOfRelatedParent(t, parentCardIdOrShortLink);
	
	// parent is on another board, and the plugindata isn't connected yet
	// get checklist from organization level plugindata instead
	if (childrenChecklistId === undefined) {
		childrenChecklistId = await t.get('organization', 'shared', 'childrenChecklistId-' + parentCardId);
		if (childrenChecklistId !== undefined) {
			let checklistExists = false;
			try {
				checklistExists = await window.Trello.get('checklists/' + childrenChecklistId, {}, function(response) {
					return true;
				},
				function(error) {
					return false;
				});
			}
			catch (error) {
				checklistExists = false;
			}
			
			if (checklistExists === false) {
				childrenChecklistId = undefined;
			}
		}
	}
	
	if (childrenChecklistId === undefined) {
		// create checklist
		const response = await addChildrenChecklist(t, parentCardIdOrShortLink);
		childrenChecklistId = response.id;
		t.set('organization', 'shared', 'childrenChecklistId-' + parentCardId, childrenChecklistId);
	}
	
	addChildCheckItem(t, childCard, childrenChecklistId).then(function() {
		markToRecacheOnRelatedParent(t, parentCardId);
	});
}

/**
 * add checklist to host children on a card
 * 
 * @param {object} t without context
 * @param {object} parentCardIdOrShortLink
 * @return {Promise}
 */
function addChildrenChecklist(t, parentCardIdOrShortLink) {
	const postData = {
		name: 'Tasks',
		pos:  'top',
	};
	
	try {
		return window.Trello.post('cards/' + parentCardIdOrShortLink + '/checklists', postData, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param {object} t without context
 * @param {object} childCard {
 *        @var {string} url
 * }
 * @param {string} checklistId
 * @return {Promise}
 */
function addChildCheckItem(t, childCard, checklistId) {
	const postData = {
		name: childCard.url,
		pos:  'bottom',
	};
	
	try {
		return window.Trello.post('checklists/' + checklistId + '/checkItems', postData, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * remove checklist hosting children on a card
 * 
 * @param {string} t context
 */
function removeChildrenFromContext(t) {
	t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			return;
		}
		
		// remove parent from each child
		const checkItems = await getCheckItemsFromRelatedParent(t, childrenChecklistId);
		for (let checkItem of checkItems) {
			let childCardShortLink = getCardShortLinkFromUrl(checkItem.name);
			let childCard          = await getCardByIdOrShortLink(t, childCardShortLink);
			let parentAttachmentId = await getParentAttachmentIdOfRelatedChild(t, childCardShortLink);
			
			// child is on another board, and the plugindata isn't connected yet
			// get attachment from organization level plugindata instead
			if (parentAttachmentId === undefined) {
				parentAttachmentId = await t.get('organization', 'shared', 'parentAttachmentId-' + childCard.id);
				t.remove('organization', 'shared', 'parentAttachmentId-' + childCard.id);
			}
			
			removeParentFromRelatedChild(t, childCard.id, parentAttachmentId);
		}
		
		// remove children checklist from parent
		const parentCardIdOrShortLink = t.getContext().card;
		removeChildrenChecklist(t, parentCardIdOrShortLink, childrenChecklistId).then(function() {
			t.remove('card', 'shared', 'childrenChecklistId').then(function() {
				recacheChildrenByContext(t);
			});
		})
	});
}

/**
 * @param  {object} t without context
 * @param  {object} parentCardIdOrShortLink
 * @param  {string} childrenChecklistId
 * @return {Promise}
 */
function removeChildrenChecklist(t, parentCardIdOrShortLink, childrenChecklistId) {
	try {
		return window.Trello.delete('cards/' + parentCardIdOrShortLink + '/checklists/' + childrenChecklistId, {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t without context
 * @param  {string} childrenChecklistId
 * @param  {string} childCheckItemId
 * @return {Promise}
 */
function removeChildCheckItem(t, childrenChecklistId, childCheckItemId) {
	try {
		return window.Trello.delete('checklists/' + childrenChecklistId + '/checkItems/' + childCheckItemId, {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t context
 * @return {object}
 */
function showParentForm(t) {
	return t.popup({
		'title': 'Add an EPIC',
		search: {
			placeholder: 'Search or paste a link',
			empty: 'Not found in card titles. — You can also paste a link to a card.',
			searching: '...',
			debounce: 300,
		},
		items: function(t, options) {
			return searchCards(t, options, 'parent', function(t, card) {
				addParentToContext(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t context
 * @return {object}
 */
function showChildrenForm(t) {
	return t.popup({
		'title': 'Add a task',
		search: {
			placeholder: 'Search or paste a link',
			empty: 'Not found in card titles. — You can also paste a link to a card.',
			searching: '...',
			debounce: 300,
		},
		items: function(t, options) {
			return searchCards(t, options, 'child', function(t, card) {
				addChildToContext(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t context
 * @param  {string} badgeType one of 'card-badges' or 'card-detail-badges'
 * @return {object} one of:
 * {}
 * {
 *         @var {string} title
 *         @var {string} text
 *         @var {Function} callback
 * }
 * {
 *         @var {string} icon
 *         @var {string} text
 *         @var {string} color
 * }
 */
function showParentState(t, badgeType) {
	// process queue
	const cardId = t.getContext().card;
	t.get('organization', 'shared', 'parentAttachmentId-' + cardId).then(function(parentAttachmentId) {
		if (parentAttachmentId === 'remove') {
			t.remove('card', 'shared', 'parentAttachmentId').then(function() {
				t.remove('organization', 'shared', 'parentAttachmentId-' + cardId);
			});
		}
		else if (parentAttachmentId !== undefined) {
			t.set('card', 'shared', 'parentAttachmentId', parentAttachmentId).then(function() {
				t.remove('organization', 'shared', 'parentAttachmentId-' + cardId);
			});
		}
	});
	
	return t.get('card', 'shared', 'parentAttachmentId').then(async function(parentAttachmentId) {
		if (parentAttachmentId === undefined) {
			return {};
		}
		
		if (badgeType === 'card-detail-badges') {
			const parentCardShortLink = await getParentShortLinkByAttachmentId(t, parentAttachmentId);
			
			// cleanup in case the attachment got removed manually
			// @todo store the parent card id in the child as well to allow auto cleaning up of the child link from the parent's checklist
			if (parentCardShortLink === undefined) {
				t.remove('card', 'shared', 'parentAttachmentId');
				t.alert({
					message:  'Please open the EPIC and remove the checkitem to this task. Note: this happens automatically if you use the card button to remove the EPIC.',
					duration: 15,
				});
				
				return {};
			}
			
			return initializeAuthorization(t).then(async function(isAuthorized) {
				let badge = {
					title: 'Part of EPIC',
					text:  'Open the EPIC card',
					callback: function(t, options) {
						t.showCard(parentCardShortLink);
					},
				};
				
				// improve by storing parent card name in plugindata
				const parentCard = await t.cards('shortLink', 'name').then(async function(cards) {
					let matchingCard = cards.find(function(card) {
						return (card.shortLink === parentCardShortLink);
					});
					
					if (matchingCard === undefined && isAuthorized) {
						matchingCard = await getCardByIdOrShortLink(t, parentCardShortLink);
					}
					
					return matchingCard;
				});
				
				if (parentCard !== undefined) {
					badge.text = parentCard.name;
				}
				
				return badge;
			});
		}
		else {
			return {
				icon:  ICON_UP,
				text:  'part of an EPIC',
				color: 'light-gray',
			};
		}
	});
}

/**
 * @param  {object} t context
 * @param  {string} parentCardId
 */
function markToRecacheOnRelatedParent(t, parentCardId) {
	t.set('organization', 'shared', 'childrenChecklistRecache-' + parentCardId, true);
}

/**
 * recache data on the parent card
 * 
 * - the shortLinks of children
 * - the number of (completed) children
 * 
 * @param  {object} t context
 */
function recacheChildrenByContext(t) {
	t.get('card', 'shared', 'childrenChecklistId').then(function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			// re-try since the checklist isn't there yet
			markToRecountOnRelatedParent(t, t.getContext().card);
			return;
		}
		
		initializeAuthorization(t).then(function(isAuthorized) {
			if (isAuthorized === false) {
				return;
			}
			
			getCheckItemsFromRelatedParent(t, childrenChecklistId).then(function(checkItems) {
				let shortLinks = [];
				let counts     = {
					total: checkItems.length,
					done:  0,
				};
				
				for (let checkItem of checkItems) {
					shortLinks.push(getCardShortLinkFromUrl(checkItem.name));
					
					if (checkItem.state === 'complete') {
						counts.done++;
					}
				}
				
				t.set('card', 'shared', 'childrenCounts', counts);
				t.set('card', 'shared', 'childrenShortLinks', shortLinks);
			});
		});
	});
}

/**
 * @param  {object} t context
 * @param  {string} badgeType one of 'card-badges' or 'card-detail-badges'
 * @return {object} one of:
 * {}
 * {
 *         @var {string} title
 *         @var {string} text
 *         @var {string} color
 * }
 * {
 *         @var {string} icon
 *         @var {string} text
 *         @var {string} color
 * }
 */
function showChildrenState(t, badgeType) {
	// process queue
	const cardId = t.getContext().card;
	t.get('organization', 'shared', 'childrenChecklistId-' + cardId).then(function(childrenChecklistId) {
		if (childrenChecklistId !== undefined) {
			t.set('card', 'shared', 'childrenChecklistId', childrenChecklistId).then(function() {
				t.remove('organization', 'shared', 'childrenChecklistId-' + cardId);
			});
		}
	});
	t.get('organization', 'shared', 'childrenChecklistRecache-' + cardId).then(function(childrenChecklistRecache) {
		if (childrenChecklistRecache !== undefined) {
			t.remove('organization', 'shared', 'childrenChecklistRecache-' + cardId);
			recacheChildrenByContext(t);
		}
	})
	
	return t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			return {};
		}
		
		const counts = await t.get('card', 'shared', 'childrenCounts');
		if (counts === undefined) {
			// sometimes we're too early
			// don't mark to recache since the recacher will already re-try
			// and we'll do it on the wrong moment
			return {};
		}
		
		if (badgeType === 'card-detail-badges') {
			return {
				title: 'Tasks',
				text:  counts.done + '/' + counts.total,
				color: (counts.done > 0 && counts.done === counts.total) ? 'green' : 'light-gray',
			};
		}
		else {
			return {
				icon:  ICON_DOWN,
				text:  counts.done + '/' + counts.total + ' tasks',
				color: (counts.done > 0 && counts.done === counts.total) ? 'green' : 'light-gray',
			};
		}
	});
}

/**
 * @param  {object} t without context
 * @return {bool}
 */
function initializeAuthorization(t) {
	return t.get('member', 'private', 'token').then(function(token) {
		if (token === undefined) {
			return false;
		}
		
		window.Trello.setToken(token);
		return true;
	},
	function() {
		return false;
	});
}

/**
 * @param  {object} t context
 * @return {object}
 */
function startAuthorization(t) {
	return t.popup({
		title:  'My Auth Popup',
		height: 170,
		url:    './authorize.html',
		args:   {
			apiKey: '9b174ff1ccf5ca94f1c181bc3d802d4b',
		},
	});
}

TrelloPowerUp.initialize({
	'card-buttons': function(t, options) {
		return initializeAuthorization(t).then(function(isAuthorized) {
			if (isAuthorized === false) {
				return [];
			}
			
			return [
				{
					text:      'EPIC',
					icon:      ICON_UP,
					condition: 'edit',
					callback:  showParentForm,
				},
				{
					text:      'Tasks',
					icon:      ICON_DOWN,
					condition: 'edit',
					callback:  showChildrenForm,
				},
			];
		});
	},
	'card-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					return showParentState(t, options.context.command);
				},
			},
			{
				dynamic: function() {
					return showChildrenState(t, options.context.command);
				},
			},
		];
	},
	'card-detail-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					return showParentState(t, options.context.command);
				},
			},
			{
				dynamic: function() {
					return showChildrenState(t, options.context.command);
				},
			},
		];
	},
	'authorization-status': function(t, options) {
		return t.get('member', 'private', 'token').then(function(token) {
			const isAuthorized = (token !== undefined);
			
			return {
				authorized: isAuthorized,
			};
		});
	},
	'show-authorization': function(t, options) {
		return startAuthorization(t);
	},
}, {
	appKey:  '9b174ff1ccf5ca94f1c181bc3d802d4b',
	appName: 'EPIC relations',
});
