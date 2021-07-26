/* global TrelloPowerUp */

var Promise = TrelloPowerUp.Promise;

const CDN_BASE_URL = document.getElementById('js-cdn-base-url').href;
const FAVICON      = CDN_BASE_URL + 'favicon.png';
const ICON_UP      = CDN_BASE_URL + 'icon-up.png';
const ICON_DOWN    = CDN_BASE_URL + 'icon-down.png';
const LIST_MAXIMUM = 10;

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
 *         @var {string} shortLink
 * }
 */
async function getCardByIdOrShortLink(t, cardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + cardIdOrShortLink + '?fields=id,name,url,shortLink,idBoard', {}, null, function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
		
		return {
			id:        response.id,
			name:      response.name,
			url:       response.url,
			shortLink: response.shortLink,
			idBoard:   response.idBoard,
		};
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

async function getPluginData(t, cardIdOrShortLink, parentOrChildren) {
	try {
		const response = await window.Trello.get('cards/' + cardIdOrShortLink + '?fields=&pluginData=true');
		if (response.pluginData.length === 0) {
			return;
		}
		
		const pluginData = response.pluginData.find(function(pluginData) {
			return (JSON.parse(pluginData.value)[parentOrChildren] !== undefined);
		});
		if (pluginData === undefined) {
			return;
		}
		
		return JSON.parse(pluginData.value)[parentOrChildren];
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
		
		return;
	}
}

async function getChecklists(t, parentCardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + parentCardIdOrShortLink + '?fields=&checklists=all&checklist_fields=all');
		
		return response.checklists;
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
		
		return;
	}
}

/**
 * @param  {object} t without context
 * @param  {string} checklistId
 * @return {Promise}
 */
function getCheckItems(t, checklistId) {
	try {
		return window.Trello.get('checklists/' + checklistId + '/checkItems?fields=name,state', {}, null,
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

async function getSyncParentData(t, attachments) {
	if (attachments === undefined) {
		attachments = await t.card('attachments').then(function(card) {
			return card.attachments;
		});
	}
	
	if (attachments.length === 0) {
		throw new Error('no attachments found to sync');
	}
	
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		throw new Error('not authorized to sync');
	}
	
	const childShortLink = await t.card('shortLink').then(function(card) {
		return card.shortLink;
	})
	
	let parentShortLink;
	let childrenOfParent;
	let parentCard;
	
	for (let attachment of attachments) {
		parentShortLink = getCardShortLinkFromUrl(attachment.url);
		if (parentShortLink === undefined) {
			continue;
		}
		
		childrenOfParent = await getPluginData(t, parentShortLink, 'children');
		if (childrenOfParent === undefined) {
			continue;
		}
		if (childrenOfParent.shortLinks.includes(childShortLink) === false) {
			continue;
		}
		
		parentCard = await getCardByIdOrShortLink(t, parentShortLink);
		
		return {
			parentCard: parentCard,
			attachment: attachment,
		};
	}
	
	throw new Error('no attachment to sync relates back to us');
}

async function getSyncChildrenData(t, currentData) {
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		throw new Error('not authorized to sync');
	}
	
	// @todo move down after fetching checklists?
	const parentShortLink = await t.card('shortLink').then(function(card) {
		return card.shortLink;
	});
	
	if (currentData !== undefined) {
		const checkItems = await getCheckItems(t, currentData.checklistId);
		const newData    = await collectChildrenDataToSync(t, checkItems, parentShortLink, currentData);
		if (newData === undefined || JSON.stringify(newData) === JSON.stringify(currentData)) {
			throw new Error('nothing changed to sync');
		}
		
		return newData;
	}
	else {
		const parentCardId = t.getContext().card;
		const checklists   = await getChecklists(t, parentCardId);
		if (checklists.length === 0) {
			throw new Error('empty checklist to sync');
		}
		
		let newData;
		for (let checklist of checklists) {
			newData = await collectChildrenDataToSync(t, checklist.checkItems, parentShortLink, currentData);
			if (newData === undefined) {
				continue;
			}
			
			return newData;
		}
	}
	
	throw new Error('no checklists to sync relates back to us');
}

async function collectChildrenDataToSync(t, checkItems, parentShortLink, currentData) {
	if (checkItems.length === 0 && currentData === undefined) {
		return;
	}
	
	let shortLinks   = [];
	let checkItemIds = {};
	let counts       = {total: 0, done:  0};
	
	let childShortLink;
	let parentOfChild;
	
	for (let checkItem of checkItems) {
		childShortLink = getCardShortLinkFromUrl(checkItem.name);
		if (childShortLink === undefined) {
			continue;
		}
		
		parentOfChild = await getPluginData(t, childShortLink, 'parent');
		if (parentOfChild === undefined) {
			// @todo needs different behavior if checklist was certain
			continue;
		}
		if (parentOfChild.shortLink !== parentShortLink) {
			// @todo needs different behavior if checklist was certain
			return;
		}
		
		shortLinks.push(childShortLink);
		checkItemIds[childShortLink] = checkItem.id;
		counts.total += 1;
		if (checkItem.state === 'complete') {
			counts.done += 1;
		}
	}
	
	return {
		checklistId:  checkItems[0].idChecklist,
		shortLinks:   shortLinks,
		checkItemIds: checkItemIds,
		counts:       counts,
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
	let parentCardShortLink = await t.get('card', 'shared', 'parent').then(function(parent) {
		if (parent !== undefined) {
			return parent.shortLink;
		}
	});
	
	// get current children
	const childCardShortLinks = await t.get('card', 'shared', 'children').then(function(children) {
		if (children !== undefined) {
			return children.shortLinks;
		}
	});
	
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
			// @todo re-enable buttons to remove parent/children
			//#if (searchTerm === '') {
			//#	if (parentOrChild === 'parent') {
			//#		await t.get('card', 'shared', 'parentAttachmentId').then(function(parentAttachmentId) {
			//#			if (parentAttachmentId !== undefined) {
			//#				cards.push({
			//#					text:     '× Remove current EPIC',
			//#					callback: function(t, options) {
			//#						removeParentFromContext(t, parentAttachmentId);
			//#						t.closePopup();
			//#					},
			//#				});
			//#			}
			//#		});
			//#	}
			//#	
			//#	if (parentOrChild === 'child') {
			//#		await t.get('card', 'shared', 'childrenChecklistId').then(function(childrenChecklistId) {
			//#			if (childrenChecklistId !== undefined) {
			//#				cards.push({
			//#					text:     '× Remove all tasks (remove the EPIC from the task card to remove a single task)',
			//#					callback: function(t, options) {
			//#						removeChildrenFromContext(t);
			//#						t.closePopup();
			//#					},
			//#				});
			//#			}
			//#		});
			//#	}
			//#}
			
			return cards;
		});
	}
}

async function addParent(t, parentCard) {
	await t.set('card', 'shared', 'updating', true);
	
	const childCardId = t.getContext().card;
	const attachment  = await createAttachment(t, parentCard, childCardId);
	storeParent(t, parentCard, attachment);
	
	const checklistId = await getPluginData(t, parentCard.shortLink, 'children').then(async function(childrenData) {
		if (childrenData !== undefined) {
			return childrenData.checklistId;
		}
		
		const checklist = await createChecklist(t, parentCard.id);
		
		return checklist.id;
	});
	
	const childCard = await t.card('url', 'shortLink');
	const checkItem = await createCheckItem(t, childCard, checklistId);
	
	if (parentCard.idBoard !== undefined) {
		queueSyncingChildren(t, parentCard.id);
	}
	else {
		storeChild(t, checklistId, childCard, checkItem, parentCard.id);
	}
	
	setTimeout(function() {
		t.remove('card', 'shared', 'updating');
	}, 100);
}

async function addChild(t, childCard) {
	await t.set('card', 'shared', 'updating', true);
	
	const checklistId = await t.get('card', 'shared', 'children').then(async function(childrenData) {
		if (childrenData !== undefined) {
			return childrenData.checklistId;
		}
		
		const parentCardId = t.getContext().card;
		const checklist    = await createChecklist(t, parentCardId);
		
		return checklist.id;
	});
	
	const checkItem = await createCheckItem(t, childCard, checklistId);
	await storeChild(t, checklistId, childCard, checkItem);
	
	const parentCard = await t.card('name', 'url', 'shortLink');
	const attachment = await createAttachment(t, parentCard, childCard.id);
	
	if (childCard.idBoard !== undefined) {
		queueSyncingParent(t, childCard.id);
	}
	else {
		storeParent(t, parentCard, attachment, childCard.id);
	}
	
	setTimeout(function() {
		t.remove('card', 'shared', 'updating');
	}, 100);
}

function storeParent(t, parentCard, attachment, contextCardId='card') {
	t.set(contextCardId, 'shared', 'parent', {
		attachmentId: attachment.id,
		shortLink:    parentCard.shortLink,
		name:         parentCard.name,
	});
}

function storeChild(t, checklistId, childCard, checkItem, contextCardId='card') {
	const defaultChildrenData = {
		checklistId:  checklistId,
		shortLinks:   [],
		checkItemIds: {},
		counts:       {total: 0, done:  0},
	};
	
	t.get(contextCardId, 'shared', 'children', defaultChildrenData).then(async function(childrenData) {
		childrenData.shortLinks.push(childCard.shortLink);
		childrenData.checkItemIds[childCard.shortLink] = checkItem.id;
		childrenData.counts.total += 1;
		
		t.set(contextCardId, 'shared', 'children', childrenData);
	});
}

function storeChildren(t, childrenData, contextCardId='card') {
	t.set(contextCardId, 'shared', 'children', childrenData);
}

function queueSyncingChildren(t, parentCardId) {
	t.set('organization', 'shared', 'sync-children-' + parentCardId, true);
}

function queueSyncingParent(t, childCardId) {
	t.set('organization', 'shared', 'sync-parent-' + childCardId, true);
}

/**
 * add parent
 * attach via Rest API instead of t.attach() to get attachment id
 * 
 * @param {object} t without context
 * @param {object} parentCard {
 *        @var {string} url
 * }
 * @param {string} childCardIdOrShortLink
 * @return {Promise}
 */
function createAttachment(t, parentCard, childCardIdOrShortLink) {
	const postData = {
		name: 'EPIC',
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
 * add checklist to host children on a card
 * 
 * @param {object} t without context
 * @param {object} parentCardIdOrShortLink
 * @return {Promise}
 */
function createChecklist(t, parentCardIdOrShortLink) {
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
function createCheckItem(t, childCard, checklistId) {
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

function showBadgeOnParent(t, badgeType) {
	return t.get('card', 'shared', 'children').then(async function(childrenData) {
		// process cross-board queue
		if (badgeType === 'card-detail-badges') {
			t.get('organization', 'shared', 'sync-children-' + t.getContext().card, false).then(function(shouldSyncChildren) {
				if (shouldSyncChildren === false) {
					return;
				}
				
				t.remove('organization', 'shared', 'sync-children-' + t.getContext().card);
				getSyncChildrenData(t, childrenData).then(function(newData) {
					storeChildren(t, newData);
				})
				.catch(function() {
					t.alert({
						message: 'Something went wrong adding the task, try creating the relationship again.',
					});
				});
			});
		}
		
		if (childrenData === undefined) {
		 	return {};
		}
		
		const color = (childrenData.counts.done > 0 && childrenData.counts.done === childrenData.counts.total) ? 'green' : 'light-gray';
		
		switch (badgeType) {
			case 'card-badges':
				return {
					icon:  ICON_DOWN,
					text:  childrenData.counts.done + '/' + childrenData.counts.total + ' tasks',
					color: color,
				};
			
			case 'card-detail-badges':
				return {
					title: 'Tasks',
					text:  childrenData.counts.done + '/' + childrenData.counts.total,
					color: color,
				};
		}
	});
}

function showBadgeOnChild(t, badgeType, attachments) {
	// process cross-board queue
	if (badgeType === 'card-detail-badges') {
		t.get('organization', 'shared', 'sync-parent-' + t.getContext().card, false).then(function(shouldSyncParent) {
			if (shouldSyncParent === false) {
				return;
			}
			
			t.remove('organization', 'shared', 'sync-parent-' + t.getContext().card);
			getSyncParentData(t, attachments).then(function(syncData) {
				storeParent(t, syncData.parentCard, syncData.attachment);
			})
			.catch(function() {
				t.alert({
					message: 'Something went wrong adding the EPIC, try creating the relationship again.',
				});
			});
		});
	}
	
	return t.get('card', 'shared', 'parent').then(async function(parentData) {
		if (parentData === undefined) {
			return {};
		}
		
		switch (badgeType) {
			case 'card-badges':
				return {
					icon:  ICON_UP,
					text:  'part of ' + parentData.name,
					color: 'light-gray',
				};
			
			case 'card-detail-badges':
				return {
					title: 'Part of EPIC',
					text:  parentData.name,
					callback: function(t, options) {
						t.showCard(parentData.shortLink);
					},
				};
		}
	});
}

/**
 * @param  {object} t context
 * @return {object}
 */
function showParentForm(t) {
	return t.popup({
		title: 'Add an EPIC',
		search: {
			placeholder: 'Search or paste a link',
			empty: 'Not found in card titles. — You can also paste a link to a card.',
			searching: '...',
			debounce: 300,
		},
		items: function(t, options) {
			return searchCards(t, options, 'parent', function(t, card) {
				addParent(t, card);
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
		title: 'Add a task',
		search: {
			placeholder: 'Search or paste a link',
			empty: 'Not found in card titles. — You can also paste a link to a card.',
			searching: '...',
			debounce: 300,
		},
		items: function(t, options) {
			return searchCards(t, options, 'child', function(t, card) {
				addChild(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t context
 * @return {object}
 */
function showDebug(t) {
	return t.popup({
		title: 'Debug EPIC relation',
		items: async function(t, options) {
			let items = [];
			
			const dateLastActivity = await t.card('dateLastActivity').then(function(card) {
				return card.dateLastActivity;
			});
			items.push({text: 'last activity: ' + dateLastActivity});
			
			const pluginData = await t.get('card', 'shared');
			
			if (pluginData.updating !== undefined) {
				items.push({text: 'updating: yes'});
			}
			else {
				items.push({text: 'updating: no'});
			}
			
			if (pluginData.parent !== undefined) {
				items.push({text: 'parent:'});
				items.push({text: '- attachmentId: ' + pluginData.parent.attachmentId});
				items.push({text: '- shortLink: ' + pluginData.parent.shortLink});
				items.push({text: '- name: ' + pluginData.parent.name});
			}
			else {
				items.push({text: 'parent: -'});
			}
			
			if (pluginData.children !== undefined) {
				items.push({text: 'children:'});
				items.push({text: '- checklistId: ' + pluginData.children.checklistId});
				items.push({text: '- shortLinks: ' + JSON.stringify(pluginData.children.shortLinks)});
				items.push({text: '- checkItemIds: ' + JSON.stringify(pluginData.children.checkItemIds)});
				items.push({text: '- counts: ' + JSON.stringify(pluginData.children.counts)});
			}
			else {
				items.push({text: 'children: -'});
			}
			
			return items;
		},
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
				{
					text:      'Debug',
					icon:      FAVICON,
					condition: 'edit',
					callback:  showDebug,
				}
			];
		});
	},
	'card-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					return showBadgeOnParent(t, options.context.command);
				},
			},
			{
				dynamic: function() {
					return showBadgeOnChild(t, options.context.command, options.attachments);
				},
			},
		];
	},
	'card-detail-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					return showBadgeOnParent(t, options.context.command);
				},
			},
			{
				dynamic: function() {
					return showBadgeOnChild(t, options.context.command);
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
