/* globals controller */
const sendEvent = require("../../browser-send-event.js");
const reactruntime = require("../../reactruntime");
const { Footer } = require("../../footer-view.js");
const React = require("react");
const ReactDOM = require("react-dom");
const { ShareButton } = require("../../share-buttons");
const Masonry = require("react-masonry-component");

class Head extends React.Component {

  render() {
    return (
      <reactruntime.HeadTemplate {...this.props}>
      { this.props.deviceId ? null : <script src={ this.props.staticLink("/static/js/wantsauth.js") } /> }
        <script src={ this.props.staticLink("/static/js/shotindex-bundle.js") } async></script>
        <link rel="stylesheet" href={ this.props.staticLink("/static/css/shot-index.css") } />
      </reactruntime.HeadTemplate>
    );
  }

}


class Body extends React.Component {
  constructor(props) {
    super(props);
    this.state = {defaultSearch: props.defaultSearch};
  }

  render() {
    return (
      <reactruntime.BodyTemplate {...this.props}>
        <div className="column-space full-height default-color-scheme">
          <div id="shot-index-header" className="header">
            <h1><a href="/shots">Firefox <strong>Screenshots</strong> <sup>Beta</sup></a></h1>
            <form onSubmit={ this.onSubmitForm.bind(this) }>
              <span className="search-label" />
              <input type="search" id="search" ref="search" maxLength="100" placeholder="search my shots" defaultValue={this.state.defaultSearch} onChange={this.onChangeSearch.bind(this)} />
              <div className="clear-search" title="clear search" onClick={this.onClearSearch.bind(this)}></div>
            </form>
          </div>
          <div id="shot-index" className="flex-1">
            { this.renderShots() }
          </div>
          <Footer forUrl="shots" {...this.props} />
        </div>
      </reactruntime.BodyTemplate>
    );
  }

  renderShots() {
    let children = [];
    for (let shot of this.props.shots) {
      let downloadUrl = this.props.downloadUrls[shot.id];
      children.push(this.renderShot(shot, downloadUrl));
    }

    if (children.length === 0) {
      if (!this.props.hasDeviceId) {
        children.push(this.renderNoDeviceId());
      } else if (this.props.defaultSearch) {
        children.push(this.renderNoSearchResults());
      } else {
        children.push(this.renderNoShots());
      }
    } else {
      return (
        <div className="masonry-wrapper">
          <Masonry onLayoutComplete={() => this.handleLayoutComplete()}>
            {children}
          </Masonry>
        </div>
      )
    }
    return children;
  }

  handleLayoutComplete() {
    const masonryWrapper = document.querySelector('.masonry-wrapper');
    masonryWrapper.style.opacity = 1;
  }

  renderNoShots() {
    return (
      <div className="no-shots" key="no-shots-found">
        <img src={ this.props.staticLink("/static/img/image-noshots_screenshots.svg") } alt="no Shots found" width="432" height="432"/>
        <p>No saved shots.</p>
        <p>Go on, create some.</p>
      </div>
    );
  }

  renderNoDeviceId() {
    return (
      <div className="no-shots" key="no-shots-found">
        <img src={ this.props.staticLink("/static/img/image-search_screenshots.svg") } alt="no Shots found" width="432" height="432"/>
        <p>Looking for your shots...</p>
      </div>
    );
  }

  renderNoSearchResults() {
    return (
      <div className="no-shots" key="no-shots-found">
        <img src={ this.props.staticLink("/static/img/image-search_screenshots.svg") } alt="no Shots found" width="432" height="432"/>
        <p>Hmmm!</p>
        <p>We can’t find any shots that match your search.</p>
      </div>
    );
  }

  getClipType(dimensions) {
    // an image is considered a square if it is within
    // a squareBuffer pixels of being one
    const squareBuffer = 50;
    if (dimensions.x - squareBuffer > dimensions.y) {
      return "landscape";
    } else if (dimensions.x < dimensions.y - squareBuffer ) {
      return "portrait";
    }
    return "square";
  }

  renderShot(shot, downloadUrl) {
    let imageUrl;
    let clip = shot.clipNames().length ? shot.getClip(shot.clipNames()[0]) : null;
    if (clip && clip.image && clip.image.url) {
      imageUrl = clip.image.url;
    } else if (shot.images.length) {
      imageUrl = shot.images[0].url;
    } else if (shot.fullScreenThumbnail) {
      imageUrl = shot.fullScreenThumbnail;
    } else {
      imageUrl = this.props.staticLinkWithHost("img/question-mark.svg");
    }
    let favicon = null;
    if (shot.favicon) {
      // We use background-image so if the image is broken it just doesn't show:
      favicon = <div style={{backgroundImage: `url("${shot.favicon}")`}} className="favicon" />;
    }

    return (
      <div className={`shot ${this.getClipType(clip._image.dimensions)}`} key={shot.id}>
        <a href={shot.viewUrl} onClick={this.onOpen.bind(this, shot.viewUrl)}>
          <div className="shot-image-container" style={{
            backgroundImage: `url(${imageUrl})`
          }}>
          </div>
          <div className="shot-info">
          <div className="title-container">
            <h4>{this.displayTitle(shot.title)}</h4>
          </div>
          <div className="link-container">
            {favicon}
            <div className="shot-url">
              {shot.urlDisplay}
            </div>
          </div>
          </div>
        </a>
        <div className="alt-actions-container">
          <a className="button transparent download" href={ downloadUrl } onClick={ this.onClickDownload.bind(this) }
            title="Download the shot image" />
          <ShareButton abTests={this.props.abTests} clipUrl={shot.urlDisplay} shot={shot} isOwner={this.props.isOwner} staticLink={this.props.staticLink} isExtInstalled={this.props.isExtInstalled} />
          <button className="button transparent trash" title="Delete this shot permanently" onClick={ this.onClickDelete.bind(this, shot) } />
        </div>
      </div>
    );
  }

  displayTitle(title) {
    if (title.length > 140) {
      return (title.substring(0, 140) + "...");
    }
    return title;
  }

  onClickDelete(shot, event) {
    event.stopPropagation();
    event.preventDefault();
    sendEvent("start-delete", "my-shots", {useBeacon: true});
    if (window.confirm(`Delete ${shot.title}?`)) {
      sendEvent("delete", "my-shots-popup-confirm", {useBeacon: true});
      controller.deleteShot(shot);
    } else {
      sendEvent("cancel-delete", "my-shots-popup-confirm");
    }
    return false;
  }

  onOpen(url, event) {
    if (event.ctrlKey || event.metaKey || event.button === 1) {
      // Don't override what might be an open-in-another-tab click
      sendEvent("goto-shot", "myshots-tile-new-tab", {useBeacon: true});
      return;
    }

    sendEvent("goto-shot", "myshots-tile", {useBeacon: true});
    location.href = url;
  }

  onClickDownload() {
    sendEvent("download", "myshots-tile");
  }

  onSubmitForm(e) {
    e.preventDefault();
    let val = ReactDOM.findDOMNode(this.refs.search).value;
    if (val) {
      sendEvent("search", "submit");
    } else {
      sendEvent("clear-search", "submit");
    }
    controller.onChangeSearch(val);
  }

  onChangeSearch() {
    let val = ReactDOM.findDOMNode(this.refs.search).value;
    this.setState({defaultSearch: val});
    if (!val) {
      sendEvent("clear-search", "keyboard");
      controller.onChangeSearch(val);
      return;
    }
    if (this._keyupTimeout) {
      clearTimeout(this._keyupTimeout);
      this._keyupTimeout = undefined;
    }
    if (val.length > 3) {
      this._keyupTimeout = setTimeout(() => {
        sendEvent("search", "timed");
        controller.onChangeSearch(val);
      }, 1000);
    }
  }

  onClearSearch(e) {
    const val = '';
    ReactDOM.findDOMNode(this.refs.search).value = val;
    this.setState({defaultSearch: val});
    controller.onChangeSearch(val);
    sendEvent("clear-search", "button");
    return null;
  }

  componentDidUpdate() {
    if ((this.props.defaultSearch || "") !== (this.state.defaultSearch || "")) {
      document.body.classList.add("search-results-loading");
    } else {
      document.body.classList.remove("search-results-loading");
    }
  }

}

exports.HeadFactory = React.createFactory(Head);
exports.BodyFactory = React.createFactory(Body);
