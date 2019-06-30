<?php

// I tried decorating every "echo", but output buffering in PHP doesn't seem to allow that.
//
// useful resource on the subject:
// https://bugs.php.net/bug.php?id=23877
// https://www.php.net/manual/en/function.ob-implicit-flush.php
// https://stackoverflow.com/a/24108276/2788187
//
// So instead, just use a wrapper around echo.

/*
function mark($a) {
return "\n----- " . strlen($a) . " -----\n" . " " . $a;
}

function registerOutputBuffer() {
// ini_set('implicit_flush',1);
// ini_set('output_buffering', 0);
// while (ob_get_level()) {ob_end_flush();}
ob_implicit_flush();
ob_start('mark');
}

registerOutputBuffer();
 */

function json($val)
{
    return json_encode($val, JSON_PRETTY_PRINT);
}

class Marker
{
    private $frames = [];
    private $marks = [];
    private $output = '';

    public function mark()
    {
        $args = func_get_args();
        $output = join($args, ' ');

        $whitelist = ['file', 'line', 'function', 'class'];
        $backtrace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS);
        // Remove `mark` and `internal_print`.
        array_shift($backtrace);
        array_shift($backtrace);
        $callStack = array_map(function ($frame) use ($whitelist) {
            $filtered = array_intersect_key($frame, array_flip($whitelist));
            return $this->getFrameId($filtered);
        }, $backtrace);

        $this->mappings[] = [
            'callStack' => $callStack,
            'len' => strlen($output),
        ];
        $this->output = $this->output . $output;
        return $output;
    }

    public function &data()
    {
        return [
            'frames' => array_values($this->frames),
            'mappings' => $this->mappings,
            // Only including HTML output because there is no way in raw JS to
            // get the original HTML sent over the wire. By the time JS has access to the DOM,
            // the browser has already done some spec-compliant parsing that can completetly modify
            // malformed HTML. This could be removed if these maps were consumed via DevTools, which has access to everything.
            // But for now, I'm doing all the map visualaziton within the page, so this is necessary.
            'output' => $this->output,
        ];
    }

    private function getFrameId($frame)
    {
        $key = $frame['file'] . $frame['line'];
        $index = array_search($key, array_keys($this->frames));
        if ($index != false) {
            return $index;
        }

        $this->frames[$key] = $frame;
        return count($this->frames) - 1;
    }
}

class View
{
    public function __construct()
    {
        $this->marker = new Marker();
    }

    private function internal_print()
    {
        $output = $this->marker->mark(...func_get_args());
        echo ($output);
    }

    function print() {
        // Ideally, all `internal_print` would be replaced with `echo`, but see file comment.
        $this->internal_print($str, ...func_get_args());
    }

    public function sayHi()
    {
        $this->internal_print("<div>hello world</div>");
    }

    public function mingle(int $i)
    {
        $this->internal_print("blah blah " . $i);
    }

    public function sayBye()
    {
        $this->mingle(100);
        $this->internal_print("<div>goodbye world</div>");
    }

    public function sayCompliment()
    {
        $this->internal_print("you're beautiful");
    }
}

function getHeader() {
    return 'HTML Source Map example';
}

$view = new View();
$view->print("<h1>", getHeader(), "</h1>");
$view->sayHi();
$view->print("<br>");
for ($i = 0; $i < 10; $i++) {
    $view->mingle($i);
    $view->print("<br>");
}
$view->sayBye();
$view->print("<br>");

?>

<!-- The "<p>hey there, " bit is not supported yet. Any actualy HTML in the .php file throws off the expected
     index of each mapping. -->
<!-- <p>hey there, <#?=$view->sayCompliment()?>!</p> -->

<script src="/js/html-source-maps.js"></script>
<script>
    window.__marks = new HTMLSourceMap(<?=json($view->marker->data())?>);
    console.log(window.__marks);
    window.__marks.debugRender();
</script>
