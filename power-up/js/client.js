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
		const pluginDataWithinContext = await t.get(cardIdOrShortLink, 'shared', parentOrChildren);
		if (pluginDataWithinContext !== undefined) {
			return pluginDataWithinContext;
		}
		
		// fall-through to get plugin data via API
	}
	catch (error) {
		// supress expected error for cards on other boards
		if (error.message === undefined || error.message !== 'Card not found or not on current board (Command: data)') {
			console.warn('Error while fetching card plugin data', error);
		}
		
		// fall-through to get plugin data via API
	}
	
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

async function getSyncChildrenData(t, parentShortLink, currentData) {
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		throw new Error('not authorized to sync');
	}
	
	if (currentData !== undefined) {
		const checkItems = await getCheckItems(t, currentData.checklistId);
		const newData    = await collectChildrenDataToSync(t, currentData.checklistId, checkItems, parentShortLink, currentData);
		if (JSON.stringify(newData) === JSON.stringify(currentData)) {
			throw new Error('nothing changed to sync');
		}
		
		return newData;
	}
	else {
		const checklists = await getChecklists(t, parentShortLink);
		if (checklists.length === 0) {
			throw new Error('empty checklist to sync');
		}
		
		let newData;
		for (let checklist of checklists) {
			newData = await collectChildrenDataToSync(t, checklist.id, checklist.checkItems, parentShortLink, currentData);
			if (newData.shortLinks.length === 0) {
				continue;
			}
			
			return newData;
		}
		
		// default to any checklist found without items
		return newData;
	}
}

async function collectChildrenDataToSync(t, checklistId, checkItems, parentShortLink, currentData) {
	let newData = {
		checklistId:  checklistId,
		shortLinks:   [],
		checkItemIds: {},
		counts:       {total: 0, done: 0},
	};
	
	if (checkItems.length === 0 && currentData === undefined) {
		return newData;
	}
	
	let childShortLink;
	let parentOfChild;
	
	for (let checkItem of checkItems) {
		childShortLink = getCardShortLinkFromUrl(checkItem.name);
		if (childShortLink === undefined) {
			continue;
		}
		
		parentOfChild = await getPluginData(t, childShortLink, 'parent');
		if (parentOfChild === undefined) {
			continue;
		}
		if (parentOfChild.shortLink !== parentShortLink) {
			if (currentData !== undefined) {
				t.alert({
					message: 'Task "' + checkItem.name + '" on the tasks checklist relates to a different parent.',
				});
			}
			continue;
		}
		
		newData.shortLinks.push(childShortLink);
		newData.checkItemIds[childShortLink] = checkItem.id;
		newData.counts.total += 1;
		if (checkItem.state === 'complete') {
			newData.counts.done += 1;
		}
	}
	
	return newData;
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
	const pluginData = await t.get('card', 'shared');
	
	// collect current parent & children
	const parentCardShortLink = (pluginData.parent   !== undefined ? pluginData.parent.shortLink    : '');
	const childCardShortLinks = (pluginData.children !== undefined ? pluginData.children.shortLinks : []);
	
	// offer to add by card link
	if (searchTerm !== '' && searchTerm.indexOf('https://trello.com/c/') === 0) {
		return t.cards('id', 'name', 'url', 'shortLink').then(async function(cards) {
			const searchShortLink = getCardShortLinkFromUrl(searchTerm);
			
			// skip already added cards
			if (parentCardShortLink === searchShortLink) {
				return [];
			}
			if (childCardShortLinks.includes(searchShortLink)) {
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
				if (parentCardShortLink === card.shortLink) {
					return false;
				}
				if (childCardShortLinks.includes(card.shortLink)) {
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
				if (parentOrChild === 'parent' && pluginData.parent !== undefined) {
					cards.push({
						text:     '× Remove current EPIC',
						callback: function(t, options) {
							removeParent(t, pluginData.parent);
							t.closePopup();
						},
					});
				}
				
				if (parentOrChild === 'child' && pluginData.children !== undefined) {
					cards.push({
						text:     '× Remove all tasks (remove the EPIC from the task card to remove a single task)',
						callback: function(t, options) {
							removeChildren(t, pluginData.children);
							t.closePopup();
						},
					});
				}
			}
			
			return cards;
		});
	}
}

async function addParent(t, parentCard) {
	await t.set('card', 'shared', 'updating', true);
	
	await t.get('card', 'shared', 'parent').then(function(parentData) {
		if (parentData !== undefined) {
			return removeParent(t, parentData);
		}
	});
	
	// add parent to child
	const childCardId = t.getContext().card;
	const attachment  = await createAttachment(t, parentCard, childCardId);
	storeParent(t, parentCard, attachment);
	
	// add child to parent
	const checklistId = await getPluginData(t, parentCard.shortLink, 'children').then(async function(childrenData) {
		if (childrenData !== undefined) {
			return childrenData.checklistId;
		}
		
		const checklist = await createChecklist(t, parentCard.id);
		
		return checklist.id;
	});
	
	const childCard = await t.card('url', 'shortLink');
	const checkItem = await createCheckItem(t, childCard, checklistId);
	
	if (parentCard.idBoard !== undefined && parentCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingChildren(t, parentCard.id);
	}
	else {
		storeChild(t, checklistId, childCard, checkItem, parentCard.id);
	}
	
	// give some time before releasing as updating
	// this seems needed as card updates from trello api can still come in
	setTimeout(function() {
		t.remove('card', 'shared', 'updating');
	}, 100);
}

async function addChild(t, childCard) {
	await t.set('card', 'shared', 'updating', true);
	
	// add child to parent
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
	
	// add parent to child
	const parentCard = await t.card('name', 'url', 'shortLink');
	const attachment = await createAttachment(t, parentCard, childCard.id);
	
	if (childCard.idBoard !== undefined && childCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingParent(t, childCard.id);
	}
	else {
		storeParent(t, parentCard, attachment, childCard.id);
	}
	
	// give some time before releasing as updating
	// this seems needed as card updates from trello api can still come in
	setTimeout(function() {
		t.remove('card', 'shared', 'updating');
	}, 100);
}

async function removeParent(t, parentData) {
	// remove parent from child
	const childCardId = t.getContext().card;
	deleteAttachment(t, childCardId, parentData.attachmentId);
	clearStoredParent(t);
	
	// remove child from parent
	const childCard        = await t.card('shortLink');
	const childrenOfParent = await getPluginData(t, parentData.shortLink, 'children');
	const checklistId      = childrenOfParent.checklistId;
	const checkItemId      = childrenOfParent.checkItemIds[childCard.shortLink];
	await deleteCheckItem(t, checklistId, checkItemId);
	
	const parentCard = await getCardByIdOrShortLink(t, parentData.shortLink);
	if (parentCard.idBoard !== undefined && parentCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingChildren(t, parentCard.id);
	}
	else {
		clearStoredChild(t, parentCard.shortLink, childrenOfParent);
	}
}

async function removeChildren(t, childrenData) {
	// remove children from parent
	const parentCardId = t.getContext().card;
	deleteChecklist(t, parentCardId, childrenData.checklistId);
	clearStoredChildren(t);
	
	// remove parent from each child
	let attachmentId = undefined;
	for (childShortLink of childrenData.shortLinks) {
		const parentOfChild = await getPluginData(t, childShortLink, 'parent');
		deleteAttachment(t, childShortLink, parentOfChild.attachmentId);
		
		const childCard = await getCardByIdOrShortLink(t, childShortLink);
		if (childCard.idBoard !== undefined && childCard.idBoard !== t.getContext().board) {
			// use organization-level plugindata to store parent data for cross-board relations
			queueSyncingParent(t, childCard.id);
		}
		else {
			clearStoredParent(t, childShortLink);
		}
	}
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

function clearStoredParent(t, contextCardId='card') {
	t.remove(contextCardId, 'shared', 'parent');
}

function clearStoredChild(t, parentShortLink, currentData) {
	// nothing specific to that child, just sync the current state assuming the checkitem was removed before
	getSyncChildrenData(t, parentShortLink, currentData).then(function(newData) {
		storeChildren(t, newData, parentShortLink);
	})
}

function clearStoredChildren(t) {
	t.remove('card', 'shared', 'children');
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
function createAttachment(t, parentCard, childCardIdOrShortLink) {
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

/**
 * @param  {object} t without context
 * @param  {string} cardIdOrShortLink
 * @param  {string} attachmentId
 * @return {Promise}
 */
function deleteAttachment(t, cardIdOrShortLink, attachmentId) {
	try {
		return window.Trello.delete('cards/' + cardIdOrShortLink + '/attachments/' + attachmentId, {}, null,
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
 * @param  {object} cardIdOrShortLink
 * @param  {string} checklistId
 * @return {Promise}
 */
function deleteChecklist(t, cardIdOrShortLink, checklistId) {
	try {
		return window.Trello.delete('cards/' + cardIdOrShortLink + '/checklists/' + checklistId, {}, null,
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
 * @param  {string} checklistId
 * @param  {string} checkItemId
 * @return {Promise}
 */
function deleteCheckItem(t, checklistId, checkItemId) {
	try {
		return window.Trello.delete('checklists/' + checklistId + '/checkItems/' + checkItemId, {}, null,
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
			t.get('organization', 'shared', 'sync-children-' + t.getContext().card, false).then(async function(shouldSyncChildren) {
				if (shouldSyncChildren === false) {
					return;
				}
				
				t.remove('organization', 'shared', 'sync-children-' + t.getContext().card);
				
				const parentCard = await t.card('shortLink');
				getSyncChildrenData(t, parentCard.shortLink, childrenData).then(function(newData) {
					storeChildren(t, newData);
				})
				.catch(function(error) {
					console.warn('Error processing queue to sync children', error);
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
			.catch(function(error) {
				console.warn('Error processing queue to sync parent', error);
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
