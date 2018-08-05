import * as CONSTS from './consts'
import { SaveFile } from './saveFile'
import { system } from './system'
import { getNowString } from '../common'

let logs = null,
    errors = null,
    records = null

let connectionToBackground = chrome.runtime.connect({ name: CONSTS.CONNECT_ID_INIT_PANEL }),
    connectionToContent = null,
    stopNetworkRequestFinishedListen = null

const tabId = chrome.devtools.inspectedWindow.tabId

function createEntryEl(id, type, html, className) {
    let entry = document.createElement(type)
    id && entry.setAttribute('id', id)
    entry.innerHTML = `${getNowString()}${html}`
    className && entry.setAttribute('class', className)

    return entry
}

function getCheckboxHtml() {
    return `<input type='checkbox' checked />`
}

function appendLog(log) {
    logs && logs.appendChild(createEntryEl(null, 'li', log))
}

function clearLogs() {
    if (logs) {
        logs.innerHTML = ''
    }
}

function appendError(error) {
    errors && errors.appendChild(createEntryEl(null, 'li', error))
}

function appendRecord(type, record) {
    records && records.appendChild(createEntryEl(records.children.length + '', 'li', `${type.value.renderSummary(record)}`))
}

function doConnectToContent(url) {
    if (!connectionToContent) {
        connectionToContent = chrome.tabs.connect(tabId, { name: CONSTS.CONNECT_ID_INIT_PANEL })
    }

    connectionToContent.postMessage({ action: 'init', tabId, url })
    connectionToContent.onDisconnect.addListener(function () {
        connectionToContent = null
        doConnectToContent(url)
    })

    connectionToContent.onMessage.addListener(function (request) {
        const theActionEnum = CONSTS.ACTION_TYPES.get(request.action)
        if (theActionEnum) {
            appendRecord(theActionEnum, request)
        }
    })
}

document.addEventListener('DOMContentLoaded', function () {
    logs = document.getElementById('logs')
    errors = document.getElementById('errors')
    records = document.getElementById('records')

    let isRuning = false,
        isEditing = false

    const btnStart = document.getElementById('btnStart'),
        btnStop = document.getElementById('btnStop'),
        btnEdit = document.getElementById('btnEdit'),
        btnSave = document.getElementById('btnSave'),
        btnMarkTarget = document.getElementById('btnMarkTarget'),
        targetSelector = document.getElementById('targetSelector')

    const getTargetSelectors = () => {
        const targetSelectorValue = (targetSelector.value || '').trim()
        return targetSelectorValue.split('\n').map(val => val.trim())
    }

    btnMarkTarget.addEventListener('click', ev => {
        const targetSelectors = getTargetSelectors(),
            markerClassName = '.__ats__target__'

        chrome.tabs.executeScript(tabId, {
            code: `Array.from(document.querySelectorAll('${markerClassName}')).forEach(el => el.remove())`
        })

        targetSelectors.forEach(selector => {
            chrome.tabs.executeScript(tabId, {
                code: `{
            let invalidSelectors = []
            const theTarget = document.querySelector('${selector}')

            if (theTarget) {
                const rect = theTarget.getBoundingClientRect()
                let div = document.createElement('div')
                div.style.position = 'absolute'
                div.style.border = 'dashed 1px red'
                div.style.top = rect.top + 'px'
                div.style.left = rect.left + 'px'
                div.style.width = rect.width + 'px'
                div.style.height = rect.height + 'px'
                div.style.opacity = '.3'
                div.style.backgroundColor = 'wheat'
                div.style.zIndex = '100000'
                div.className = '${markerClassName}'

                document.body.appendChild(div)
            } else {
                invalidSelectors.push(selector)
            }
            
            if(invalidSelectors.length){
                alert('invalid selectors: ' + invalidSelectors.join(','))
            }
        }` })
        })
    })

    connectionToBackground.onDisconnect.addListener(function () {
        connectionToBackground = null
    })

    chrome.webNavigation.onCommitted.addListener((ev) => {
        const { tabId: currentTabId, url, frameId, timeStamp } = ev

        // frameId 表示当前page中frame的ID，0表示window.top对应frame，正数表示其余subFrame
        if (isRuning && currentTabId === tabId && frameId === 0) {
            doConnectToContent(url)
            connectionToBackground.postMessage({ action: CONSTS.ACTION_TYPES.NAVIGATE.key, url })
            appendRecord(CONSTS.ACTION_TYPES.NAVIGATE, { url })
        }
    })

    connectionToBackground.onMessage.addListener(function (request) {
        const { action, data } = request
        switch (action) {
            case 'start':
                btnStart.disabled = true
                btnStop.disabled = false
                btnSave.disabled = true
                btnMarkTarget.disabled = true
                isRuning = true

                clearLogs()
                watchNetwork()
                break
            case 'dump':
                const now = new Date()
                let finalData = data

                if (isEditing) {
                    var list = records.querySelectorAll('input[type="checkbox"]')
                }

                SaveFile.saveJson({
                    id: +now,
                    version: system.version,
                    rootTargets: getTargetSelectors(),
                    createAt: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`,
                    data: Object.keys(data).reduce((prev, next) => {
                        prev[next] = data[next].filter(entry => {
                            return entry.id
                        })

                        return prev
                    }, {})
                }, document, `ats_data.json`)
                break
            default:
                break
        }
    })

    function watchNetwork() {
        if (connectionToBackground) {
            appendLog('开始网络监听')
            stopNetworkRequestFinishedListen = false
            chrome.devtools.network.onRequestFinished.addListener(
                function (request) {
                    //启用状态才需要继续
                    if (!stopNetworkRequestFinishedListen) {
                        //skip the images
                        if (request.response && request.response.content && request.response.content.mimeType && request.response.content.mimeType.match(/^image\//i)) {
                            return
                        } else {
                            request.getContent(function (content) {
                                const { request: innerRequest, response } = request,
                                    toRecordHeaderTypes = ['Access-Control-Allow-Credentials', 'Content-Type', 'Access-Control-Allow-Origin', 'Content-Security-Policy'],
                                    { url, postData: form, method } = innerRequest,
                                    status = response.status,
                                    headers = response.headers || [],
                                    body = content

                                let finalHeadersIsValid = false,
                                    finalHeaders = {}

                                toRecordHeaderTypes.forEach(headerType => {
                                    let matchedHeader = headers.find(header => (header.name || '').toLowerCase() === headerType.toLocaleLowerCase())

                                    if (matchedHeader) {
                                        finalHeadersIsValid = true
                                        finalHeaders = Object.assign({}, finalHeaders, { [headerType]: headerType === 'Content-Type' ? matchedHeader.value.replace(/\bcharset=([\w\-]+)\b/ig, 'charset=utf-8') : matchedHeader.value })
                                    }
                                })

                                connectionToBackground.postMessage({ action: CONSTS.ACTION_TYPES.NETWORK.key, url, status, method, body, form, header: (finalHeadersIsValid ? finalHeaders : null) })
                                appendRecord(CONSTS.ACTION_TYPES.NETWORK, { url, method, body, form })
                            })
                        }
                    }
                })
        } else {
            appendError('connectionWatchPanel为空，不能启动监听网络，可能尚未启动初始化')
        }
    }

    function stopWatchNetwork() {
        if (!stopNetworkRequestFinishedListen) {
            stopNetworkRequestFinishedListen = true
        }
    }

    btnStart.addEventListener('click', (ev) => {
        if (isRuning) {
            return
        }

        isRuning = true
        isEditing = false

        connectionToBackground.postMessage({ action: 'init', tabId })
    })

    btnStop.addEventListener('click', (ev) => {
        if (!isRuning) {
            return
        }

        btnStart.disabled = false
        btnStop.disabled = true
        btnEdit.disabled = false
        btnSave.disabled = false
        btnMarkTarget.disabled = false
        isRuning = false
        isEditing = false

        stopWatchNetwork()

        connectionToBackground && connectionToBackground.postMessage({ action: 'stop' })
        connectionToContent && connectionToContent.postMessage({ action: 'stop' })

        appendLog('停止监听...')
    })

    btnEdit.addEventListener('click', (ev) => {
        if (isRuning) {
            return
        }

        if (isEditing) {
            return
        }

        isRuning = false
        isEditing = true

        let recordChildren = Array.from(records.children),
            childrenHtml = ''

        recordChildren.forEach(child => {
            const html = child.outerHTML,
                match = html.match(/(<[a-zA-Z\d=\s\'\"_]*?>)(.*)/)

            if (match && match.length === 3) {
                childrenHtml += `${match[1]}${getCheckboxHtml()}${match[2]}`
            }
        })

        records.innerHTML = childrenHtml
    })

    btnSave.addEventListener('click', (ev) => {
        if (isRuning) {
            return
        }

        connectionToBackground && connectionToBackground.postMessage({ action: 'save' })
        connectionToContent && connectionToContent.postMessage({ action: 'save' })
    })
})