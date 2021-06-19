/* global TrelloPowerUp */

var Promise = TrelloPowerUp.Promise;

const CDN_BASE_URL = document.getElementById('js-cdn-base-url').href;
const ICON_UP      = CDN_BASE_URL + 'icon-up.png';
const ICON_DOWN    = CDN_BASE_URL + 'icon-down.png';
const LIST_MAXIMUM = 10;

function getParentByAttachmentId(t, parentAttachmentId) {
	return t.card('attachments').then(async function(card) {
		const parentAttachment = card.attachments.find(function(attachment) {
			return (attachment.id === parentAttachmentId);
		});
		
		// if the attachment was removed manually
		if (parentAttachment === undefined) {
			return undefined;
		}
		
		const parentCardId = getCardIdFromUrl(parentAttachment.url);
		
		return parentCardId;
	});
}

async function getParentAttachmentIdOfRelatedChild(t, childCardId) {
	try {
		const response = await window.Trello.get('cards/' + childCardId + '/pluginData', {}, null, function(error) {
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

async function getChildrenChecklistIdOfRelatedParent(t, parentCardId) {
	try {
		const response = await window.Trello.get('cards/' + parentCardId + '/pluginData', {}, null, function(error) {
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

function getCardIdFromUrl(cardUrl) {
	const matches = cardUrl.match(/^https:\/\/trello\.com\/c\/([^/]+)(\/|$)/);
	if (matches === null) {
		return undefined;
	}
	
	const shortLink = matches[1];
	
	return shortLink;
}

async function getCardByShortLink(t, shortLink) {
	try {
		const response = await window.Trello.get('cards/' + shortLink + '?fields=id,name,url', {}, function(response) {
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
 * search cards
 */
async function searchCards(t, options, parentOrChild, callback) {
	const searchTerm = options.search;
	
	// collect current parent
	let parentCardId = undefined;
	await t.get('card', 'shared', 'parentAttachmentId').then(async function(parentAttachmentId) {
		if (parentAttachmentId !== undefined) {
			parentCardId = await getParentByAttachmentId(t, parentAttachmentId);
		}
	});
	
	// collect current children
	let childCardIds = [];
	await t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		if (childrenChecklistId !== undefined) {
			const checkItems = await getCheckItemsFromRelatedParent(t, childrenChecklistId);
			for (let checkItem of checkItems) {
				childCardIds.push(getCardIdFromUrl(checkItem.name));
			}
		}
	});
	
	return new Promise(function (resolve) {
		// offer to add by card link
		if (searchTerm !== '' && searchTerm.indexOf('https://trello.com/c/') === 0) {
			resolve(t.cards('id', 'name', 'url', 'shortLink').then(async function(cards) {
				const searchShortLink = getCardIdFromUrl(searchTerm);
				
				// skip already added cards
				if (parentCardId !== undefined && parentCardId === searchShortLink) {
					return [];
				}
				if (childCardIds !== undefined && childCardIds.includes(searchShortLink)) {
					return [];
				}
				
				// try to find the title of the linked card
				let matchingCard = cards.find(function(card) {
					return (card.shortLink === searchShortLink);
				});
				
				// skip self
				if (matchingCard.id === t.getContext().card) {
					return [];
				}
				
				// get the card from another board
				if (matchingCard === undefined) {
					matchingCard = await getCardByShortLink(t, searchShortLink);
				}
				
				return [
					{
						text: matchingCard.name,
						callback: function(t, options) {
							callback(t, matchingCard);
						},
					},
				];
			}));
		}
		else {
			resolve(t.cards('id', 'name', 'url', 'shortLink', 'dateLastActivity').then(async function(cards) {
				// skip self and already added cards
				cards = cards.filter(function(card) {
					if (t.getContext().card === card.id) {
						return false;
					}
					if (parentCardId !== undefined && parentCardId === card.shortLink) {
						return false;
					}
					if (childCardIds !== undefined && childCardIds.includes(card.shortLink)) {
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
			}));
		}
	});
}

/**
 * add parent to a card
 */
function addParentToContext(t, parentCard) {
	t.get('card', 'shared', 'parentAttachmentId').then(async function(parentAttachmentId) {
		if (parentAttachmentId !== undefined) {
			removeParentFromContext(t, parentAttachmentId);
		}
		
		addParentAttachment(t, parentCard, t.getContext().card).then(async function(response) {
			t.set('card', 'shared', 'parentAttachmentId', response.id);
			const childCard = await t.card('id', 'name', 'url');
			addChildToRelatedParent(t, childCard, parentCard);
		});
	});
}

/**
 * sync so child get context as parent
 */
async function addParentToRelatedChild(t, parentCard, childCard) {
	const parentAttachmentId = await getParentAttachmentIdOfRelatedChild(t, childCard.id);
	if (parentAttachmentId !== undefined) {
		t.alert({
			message: 'That task is already part of another EPIC. Change the EPIC on that card to switch.',
		});
	}
	else {
		addParentAttachment(t, parentCard, childCard.id).then(function(response) {
			t.set('organization', 'shared', 'parentAttachmentId-' + childCard.id, response.id);
		});
	}
}

/**
 * add parent
 * attach via Rest API instead of t.attach() to get attachment id
 */
function addParentAttachment(t, parentCard, childCardId) {
	const postData = {
		name: 'EPIC: ' + parentCard.name,
		url:  parentCard.url,
	};
	
	try {
		return window.Trello.post('cards/' + childCardId + '/attachments', postData, null,
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
 */
async function removeParentFromContext(t, parentAttachmentId) {
	await t.remove('card', 'shared', 'parentAttachmentId');
	
	t.card('shortLink', 'attachments').then(async function(card) {
		const parentAttachment = card.attachments.find(function(attachment) {
			return (attachment.id === parentAttachmentId);
		});
		
		const childCardId = t.getContext().card;
		removeParentAttachment(t, childCardId, parentAttachmentId);
		
		const parentCardShortLink = getCardIdFromUrl(parentAttachment.url);
		let childrenChecklistId   = await getChildrenChecklistIdOfRelatedParent(t, parentCardShortLink);
		
		// parent is on another board, and the plugindata isn't connected yet
		// get checklist from organization level plugindata instead
		if (childrenChecklistId === undefined) {
			const parentCard    = await getCardByShortLink(t, parentCardShortLink);
			childrenChecklistId = await t.get('organization', 'shared', 'childrenChecklistId-' + parentCard.id);
		}
		
		const response = await getCheckItemsFromRelatedParent(t, childrenChecklistId);
		
		const childCheckItem = response.find(function(checkItem) {
			let childCheckItemShortLink = getCardIdFromUrl(checkItem.name);
			return (childCheckItemShortLink === card.shortLink);
		});
		
		removeChildCheckItem(t, childrenChecklistId, childCheckItem.id);
	});
}

function removeParentFromRelatedChild(t, childCardId, parentAttachmentId) {
	t.set('organization', 'shared', 'parentAttachmentId-' + childCardId, 'remove').then(function() {
		removeParentAttachment(t, childCardId, parentAttachmentId);
	});
}

function removeParentAttachment(t, childCardId, parentAttachmentId) {
	try {
		return window.Trello.delete('cards/' + childCardId + '/attachments/' + parentAttachmentId, {}, null,
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
 * add child to a card
 */
async function addChildToContext(t, childCard) {
	const parentAttachmentId = await getParentAttachmentIdOfRelatedChild(t, childCard.id);
	if (parentAttachmentId !== undefined) {
		t.alert({
			message: 'That task is already part of another EPIC. Change the EPIC on that card to switch.',
		});
		return;
	}
	
	t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		const parentCard = await t.card('id', 'name', 'url');
		
		if (childrenChecklistId === undefined) {
			const response = await addChildrenChecklist(t, parentCard);
			childrenChecklistId = response.id;
			t.set('card', 'shared', 'childrenChecklistId', childrenChecklistId);
		}
		
		addChildCheckItem(t, childCard, childrenChecklistId).then(function(response) {
			addParentToRelatedChild(t, parentCard, childCard);
		});
	});
}

/**
 * sync so parent gets context as child
 */
async function addChildToRelatedParent(t, childCard, parentCard) {
	let childrenChecklistId = await getChildrenChecklistIdOfRelatedParent(t, parentCard.id);
	
	// parent is on another board, and the plugindata isn't connected yet
	// get checklist from organization level plugindata instead
	if (childrenChecklistId === undefined) {
		childrenChecklistId = await t.get('organization', 'shared', 'childrenChecklistId-' + parentCard.id);
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
		const response = await addChildrenChecklist(t, parentCard);
		childrenChecklistId = response.id;
		t.set('organization', 'shared', 'childrenChecklistId-' + parentCard.id, childrenChecklistId);
	}
	
	addChildCheckItem(t, childCard, childrenChecklistId);
}

/**
 * add checklist to host children on a card
 */
function addChildrenChecklist(t, parentCard) {
	const postData = {
		name: 'Tasks',
		pos:  'top',
	};
	
	try {
		return window.Trello.post('cards/' + parentCard.id + '/checklists', postData, null,
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
 */
function removeChildrenFromContext(t) {
	t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			return;
		}
		
		// remove parent from each child
		const response = await getCheckItemsFromRelatedParent(t, childrenChecklistId);
		for (let checkItem of response) {
			let childCardShortLink = getCardIdFromUrl(checkItem.name);
			let childCard          = await getCardByShortLink(t, childCardShortLink);
			let parentAttachmentId = await getParentAttachmentIdOfRelatedChild(t, childCard.id);
			
			// child is on another board, and the plugindata isn't connected yet
			// get attachment from organization level plugindata instead
			if (parentAttachmentId === undefined) {
				parentAttachmentId = await t.get('organization', 'shared', 'parentAttachmentId-' + childCard.id);
				t.remove('organization', 'shared', 'parentAttachmentId-' + childCard.id);
			}
			
			removeParentFromRelatedChild(t, childCard.id, parentAttachmentId);
		}
		
		// remove children checklist from parent
		const parentCard = await t.card('id', 'name', 'url');
		removeChildrenChecklist(t, parentCard, childrenChecklistId).then(function() {
			t.remove('card', 'shared', 'childrenChecklistId');
		})
	});
}

function removeChildrenChecklist(t, parentCard, childrenChecklistId) {
	try {
		return window.Trello.delete('cards/' + parentCard.id + '/checklists/' + childrenChecklistId, {}, null,
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
			const parentCardId = await getParentByAttachmentId(t, parentAttachmentId);
			
			// cleanup in case the attachment got removed manually
			// @todo store the parent card id in the child as well to allow auto cleaning up of the child link from the parent's checklist
			if (parentCardId === undefined) {
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
						t.showCard(parentCardId);
					},
				};
				
				// improve by storing parent card name in plugindata
				const parentCard = await t.cards('shortLink', 'name').then(async function(cards) {
					let matchingCard = cards.find(function(card) {
						return (card.shortLink === parentCardId);
					});
					
					if (matchingCard === undefined && isAuthorized) {
						matchingCard = await getCardByShortLink(t, parentCardId);
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

async function showChildrenState(t, badgeType) {
	// process queue
	const cardId = t.getContext().card;
	t.get('organization', 'shared', 'childrenChecklistId-' + cardId).then(function(childrenChecklistId) {
		if (childrenChecklistId !== undefined) {
			t.set('card', 'shared', 'childrenChecklistId', childrenChecklistId).then(function() {
				t.remove('organization', 'shared', 'childrenChecklistId-' + cardId);
			});
		}
	});
	
	t.get('card', 'shared', 'childrenChecklistId').then(function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			return;
		}
		
		initializeAuthorization(t).then(function(isAuthorized) {
			if (isAuthorized === false) {
				return;
			}
			
			getCheckItemsFromRelatedParent(t, childrenChecklistId).then(function(checkItems) {
				let counts = {
					total: checkItems.length,
					done:  0,
				};
				
				for (let checkItem of checkItems) {
					if (checkItem.state === 'complete') {
						counts.done++;
					}
				}
				
				t.set('card', 'shared', 'childrenCounts', counts);
			});
		});
	});
	
	return await t.get('card', 'shared', 'childrenChecklistId').then(async function(childrenChecklistId) {
		if (childrenChecklistId === undefined) {
			return {};
		}
		
		const counts = await t.get('card', 'shared', 'childrenCounts');
		
		if (badgeType === 'card-detail-badges') {
			return {
				title: 'Tasks',
				text:  (counts !== undefined) ? counts.done + '/' + counts.total : '...',
				color: (counts !== undefined && counts.done > 0 && counts.done === counts.total) ? 'green' : 'light-gray',
			};
		}
		else {
			return {
				icon:  ICON_DOWN,
				text:  (counts !== undefined) ? counts.done + '/' + counts.total + ' tasks' : '...',
				color: (counts !== undefined && counts.done > 0 && counts.done === counts.total) ? 'green' : 'light-gray',
			};
		}
	});
}

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
					const promises = [
						showParentState(t, options.context.command),
					];
					
					return Promise.all(promises).then(function(badges) {
						return badges[0];
					});
				},
			},
			{
				dynamic: function() {
					const promises = [
						showChildrenState(t, options.context.command),
					];
					
					return Promise.all(promises).then(function(badges) {
						return badges[0];
					});
				},
			},
		];
	},
	'card-detail-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					const promises = [
						showParentState(t, options.context.command),
					];
					
					return Promise.all(promises).then(function(badges) {
						return badges[0];
					});
				},
			},
			{
				dynamic: function() {
					const promises = [
						showChildrenState(t, options.context.command),
					];
					
					return Promise.all(promises).then(function(badges) {
						return badges[0];
					});
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
