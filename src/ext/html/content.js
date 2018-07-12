const Selector = require('css-selector-generator')
const selector = new Selector()

let currentTabId = 0

function watchDomMutations() {
    var connection = chrome.runtime.connect({
        name: "ats_watch_dom_mutation"
    })

    var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            const targetSelector = selector.getSelector(mutation.target)

            connection.postMessage({
                type: mutation.type,
                target: targetSelector,
                addedNodes: mutation.addedNodes,
                attributeName: mutation.attributeName,
                removedNodes: mutation.removedNodes
            })
        });
    })

    mutationObserver.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
        attributeOldValue: true,
        characterDataOldValue: true
    })
}

function watchUserActivities() {
    var connection = chrome.runtime.connect({
        name: "ats_watch_user_activities"
    })

    document.addEventListener('keydown', function (ev) {
        /*
            ev.target:      <input id=​"kw" name=​"wd" class=​"s_ipt" value maxlength=​"255" autocomplete=​"off">​
            ev.keyCode:     96
            ev.ctrlKey:     false
            ev.shiftKey:    false
        */

        const { target, keyCode, ctrlKey, shiftKey } = ev
        connection.postMessage({ target: selector.getSelector(ev.target), keyCode, ctrlKey, shiftKey })
    })
}

document.addEventListener('DOMContentLoaded', function () {
    watchDomMutations()
    watchUserActivities()
})

